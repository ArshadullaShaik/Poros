import {sourceKey} from '../../../integrations/arkiv/trade-contracts.ts';
import {canonical} from '../../../integrations/arkiv/codec.ts';
import type {LedgerEntry,LedgerCoverage,VerifiedFill} from '../../../integrations/arkiv/trade-contracts.ts';
const units=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a!+b.padEnd(36,'0'));};
const decimal=(v:bigint)=>{const a=(v<0n?-v:v).toString().padStart(37,'0'),b=a.slice(-36).replace(/0+$/,'');return (v<0n?'-':'')+a.slice(0,-36)+(b?'.'+b:'');};
export function buildTradeReport(entries:LedgerEntry[],{now=Date.now(),pending=false,renewalHealthy=true}:{now?:number;pending?:boolean;renewalHealthy?:boolean}={}) {
 const unique=new Map<string,LedgerEntry>(),conflicts=new Set<string>();
 for(const e of entries){const old=unique.get(e.identity);if(old&&old.recordHash!==e.recordHash)conflicts.add(e.identity);else if(!old)unique.set(e.identity,e);if(e.kind==='dispute')conflicts.add(e.data.identity);}
 const records=[...unique.values()],sources=new Map<string,{source:LedgerEntry['source'];coverage:LedgerCoverage|null;linkedAt:number;active:boolean}>();
 for(const e of records.filter(e=>e.kind==='source-link').sort((a,b)=>a.observedAt-b.observedAt)){const id=sourceKey(e.source);if(!sources.has(id))sources.set(id,{source:e.source,coverage:null,linkedAt:e.observedAt,active:true});}
 for(const [id,s]of sources){
  const events=records.filter(e=>sourceKey(e.source)===id);
  const latest=events.filter(e=>e.kind==='source-link'||e.kind==='source-unlink').sort((a,b)=>b.observedAt-a.observedAt)[0];s.active=latest?.kind!=='source-unlink';
  const coverage=events.filter(e=>e.kind==='coverage').sort((a,b)=>b.observedAt-a.observedAt)[0];if(coverage?.kind==='coverage')s.coverage=coverage.data;
 }
 let complete=sources.size>0&&!pending&&renewalHealthy&&conflicts.size===0&&[...sources.values()].every(s=>s.active&&s.coverage?.sourceExhausted&&!s.coverage.gaps.length&&!s.coverage.disputed&&s.coverage.renewalHealthy&&s.coverage.lastSyncedAt<=now&&s.coverage.through<=now&&now-s.coverage.lastSyncedAt<=300000&&now-s.coverage.through<=300000);
 type Position={quantity:bigint;basis:bigint;pnl:bigint;unknown:boolean;sells:number;market:string;chain:string;currency:string;marketId:string;feesKnown:boolean};
 const positions=new Map<string,Position>();let fees=0n,feesComplete=true;
 const transactions:{orderId:string;transactionId:string;marketId:string;market:string;chain:string;currency:string;side:'BUY'|'SELL';quantity:string;value:string;feeUsd:string|null;filledAt:number;realizedPnl:string|null;sourceWallet:string;entityKey:string}[]=[];
 const transactionPositions=new Map<object,Position>(),economic=new Map<string,LedgerEntry&{kind:'fill';data:VerifiedFill}>();
 for(const e of records.filter((e):e is LedgerEntry&{kind:'fill';data:VerifiedFill}=>e.kind==='fill'&&sources.has(sourceKey(e.source))).sort((a,b)=>a.source.kind.localeCompare(b.source.kind)||a.identity.localeCompare(b.identity))){
  const f=e.data,k=e.source.wallet+':'+f.baseAsset+'/'+f.quoteAsset+':'+f.orderId+':'+f.fillId,old=economic.get(k);
  if(old){const {evidenceHash:oldEvidence,...prior}=old.data,{evidenceHash:newEvidence,...next}=f;if(canonical(prior)!==canonical(next)){conflicts.add(old.identity);conflicts.add(e.identity);}}else economic.set(k,e);
 }
 if(conflicts.size)complete=false;
 const fills=[...economic.values()].sort((a,b)=>a.data.filledAt-b.data.filledAt||a.identity.localeCompare(b.identity));
 const timeSides=new Map<string,Set<string>>();
 for(const e of fills){const f=e.data,k=e.source.wallet+':'+f.baseAsset+'/'+f.quoteAsset+':'+f.filledAt;const sides=timeSides.get(k)??new Set();sides.add(f.side);timeSides.set(k,sides);}
 for(const e of fills){
  const f=e.data,id=f.baseAsset+'/'+f.quoteAsset,k=e.source.wallet+':'+id;
  let p=positions.get(k);if(!p){p={quantity:0n,basis:0n,pnl:0n,unknown:!complete,sells:0,market:f.market,chain:f.chain,currency:f.currency,marketId:id,feesKnown:true};positions.set(k,p);}
  if(conflicts.has(e.identity)||timeSides.get(k+':'+f.filledAt)!.size>1)p.unknown=true;
  const quantity=units(f.quantity),value=units(f.value);let pnl:bigint|null=null;
  if(f.feeUsd===null){p.feesKnown=false;feesComplete=false;}else fees+=units(f.feeUsd);
  if(f.side==='BUY'){p.quantity+=quantity;p.basis+=value;}
  else{p.sells++;if(quantity>p.quantity||p.quantity===0n){p.unknown=true;p.quantity=0n;p.basis=0n;}else{const cost=p.basis*quantity/p.quantity;pnl=value-cost;p.pnl+=pnl;p.basis-=cost;p.quantity-=quantity;}}
  const row={orderId:f.orderId,transactionId:f.transactionId,marketId:id,market:f.market,chain:f.chain,currency:f.currency,side:f.side,quantity:f.quantity,value:f.value,feeUsd:f.feeUsd,filledAt:f.filledAt,realizedPnl:!p.unknown&&pnl!==null?decimal(pnl):null,sourceWallet:e.source.wallet,entityKey:e.entityKey};transactions.push(row);transactionPositions.set(row,p);
 }
 const markets=new Map<string,{marketId:string;market:string;chain:string;currency:string;realizedPnl:string|null;sells:number;eligibleForRanking:boolean}>();
 for(const p of positions.values()){
  const old=markets.get(p.marketId),known=!p.unknown&&(!old||old.realizedPnl!==null);
  const prior=old?.realizedPnl??'0',negative=prior.startsWith('-'),priorUnits=units(prior.replace(/^-/,'').toString())*(negative?-1n:1n);
  markets.set(p.marketId,{marketId:p.marketId,market:p.market,chain:p.chain,currency:p.currency,realizedPnl:known?decimal(priorUnits+p.pnl):null,sells:(old?.sells??0)+p.sells,eligibleForRanking:known&&p.feesKnown&&(old?.eligibleForRanking??true)});
 }
 // A later unmatched sell invalidates earlier apparent profits in the same source/market.
 for(const row of transactions)if(transactionPositions.get(row)?.unknown)row.realizedPnl=null;
 const coverage=[...sources.values()].map(s=>({wallet:s.source.wallet,kind:s.source.kind,active:s.active,linkedAt:s.linkedAt,...s.coverage}));
 const latestOrders=new Map<string,LedgerEntry&{kind:'order'}>();
 for(const e of records.filter((e):e is LedgerEntry&{kind:'order'}=>e.kind==='order').sort((a,b)=>a.observedAt-b.observedAt))latestOrders.set(e.source.wallet+':'+e.data.orderId,e);
 return {provenance:'arkiv' as const,complete,fills:fills.length,feesUsd:decimal(fees),feesComplete,markets:[...markets.values()],transactions:transactions.reverse(),coverage,
  orders:[...latestOrders.values()].map(e=>({source:e.source,data:e.data,entityKey:e.entityKey,observedAt:e.observedAt})),
  message:!sources.size?'Link a trading source to start recording.':pending?'Recording is delayed; some records await verified inclusion.':!complete?'History is incomplete, stale, disputed or no longer continuously tracked.':'Verified Arkiv history is current. Profits are gross; USD fees are shown separately.',
 };
}
export type TradeReport=ReturnType<typeof buildTradeReport>;
