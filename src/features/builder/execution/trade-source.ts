import {createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {domainHash} from '../../../integrations/arkiv/codec.ts';
import {sourceSchema,fillSchema} from '../../../integrations/arkiv/trade-contracts.ts';
import type {TradeSourceRef,SourceBinding,SourcePage,VerifiedOrder} from '../../../integrations/arkiv/trade-contracts.ts';
import {readBoundedJson} from '../ai/zero-g.ts';
const text=(v:unknown)=>{if(typeof v!=='string'||!v.length||v.length>256)throw new Error('Invalid source evidence');return v;};
const matches=(a:unknown,b:string)=>typeof a==='string'&&(b.startsWith('0x')?a.toLowerCase()===b.toLowerCase():a===b);
function asset(a:any){const namespace=text(a?.chain?.namespace),id=text(a?.chain?.id),address=text(a?.address);if(!['eip155','solana'].includes(namespace))throw new Error('Unsupported asset network');return {id:namespace+':'+id+':'+(namespace==='eip155'?address.toLowerCase():address),chain:text(a.chain.name),ticker:text(a.ticker)};}
export function normalizeTradeOrder(input:any,source:TradeSourceRef,observedAt?:number):VerifiedOrder {
 sourceSchema.parse(source);
 const o=input?.order;
 if(!o||!Array.isArray(input.fills)||input.fills.length>1000)throw new Error('Invalid order evidence');
 if(source.kind==='flash'&&(!matches(o.funderAddress,source.wallet)||o.recipientAddress&&!matches(o.recipientAddress,source.wallet)))throw new Error('Source wallet mismatch');
 if(source.kind==='portfolio'&&o.portfolioId!==source.sourceId)throw new Error('Source portfolio mismatch');
 const side=source.kind==='flash'?o.side:o.orderSide==='ORDER_SIDE_BUY'?'buy':o.orderSide==='ORDER_SIDE_SELL'?'sell':undefined;
 if(!['buy','sell'].includes(side))throw new Error('Invalid order side');
 const orderId=text(o.orderId),base=asset(o.targetAsset),quote=asset(o.contraAsset),status=text(o.status);
 if(!/^ORDER_STATUS_(PENDING|ACCEPTED|PARTIALLY_FILLED|FILLED|CANCELLED|REJECTED|TERMINATED)$/.test(status))throw new Error('Unknown source status');
 const fills=input.fills.filter((f:any)=>f.status==='CHAIN_STATUS_FINALIZED').map((f:any)=>{
  if(f.rootOrderId!==orderId)throw new Error('Fill order mismatch');
  const fillId=text(f.orderId)+':'+text(f.transactionId),evidenceHash=domainHash('trade-fill-evidence',{source,orderId,side,base,quote,fill:f});
  const fill=fillSchema.parse({fillId,orderId,chain:base.chain,baseAsset:base.id,quoteAsset:quote.id,market:base.ticker+' / '+quote.ticker,currency:quote.ticker,side:side.toUpperCase(),quantity:f.targetAmount,value:f.contraAmount,
   feeUsd:f.feeNotional??null,feeAmount:f.feeAmount??null,feeAsset:f.feeTicker??null,filledAt:Date.parse(f.filledAt),transactionId:f.transactionId,evidenceHash});
  if(Number(fill.quantity)<=0||Number(fill.value)<=0)throw new Error('Empty fill');
  if(observedAt!==undefined&&fill.filledAt>observedAt+300000)throw new Error('Future execution evidence');return fill;
 });
 return {orderId,status,fills,market:base.ticker+' / '+quote.ticker,chain:base.chain,currency:quote.ticker,side:side==='buy'?'BUY':'SELL',evidenceHash:domainHash('trade-order-evidence',{source,orderId,status})};
}
export type SourceCredentials={key:string;secret?:string};
export function createTradeSource({fetcher=fetch,credentials,now=Date.now,pause=(signal:AbortSignal)=>delay(250,undefined,{signal})}:{fetcher?:typeof fetch;credentials:(source:TradeSourceRef)=>SourceCredentials;now?:()=>number;pause?:(signal:AbortSignal)=>Promise<void>}) {
 async function request(source:TradeSourceRef,path:string,params:Record<string,string>,signal:AbortSignal){
  const auth=credentials(source);if(!auth?.key)throw new Error('SOURCE_NOT_CONFIGURED');
  const query=new URLSearchParams(params).toString();const headers:Record<string,string>={'x-definitive-api-key':auth.key};
  if(source.kind==='portfolio'){
   if(!auth.secret?.startsWith('dpks_'))throw new Error('SOURCE_NOT_CONFIGURED');
   const timestamp=String(now());headers['x-definitive-timestamp']=timestamp;
   const sorted=Object.entries(headers).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}:${JSON.stringify(v)}`).join(',');
   headers['x-definitive-signature']=createHmac('sha256',auth.secret.slice(5)).update(`GET:${path}?${query}:${timestamp}:${sorted}`).digest('hex');
  }
  const response=await fetcher((source.kind==='flash'?'https://flash.definitive.fi':'https://ddp.definitive.fi')+path+(query?'?'+query:''),{method:'GET',headers,redirect:'error',signal});
  if(!response.ok){const retry=response.headers.get('retry-after');void response.body?.cancel().catch(()=>{});const error=new Error('SOURCE_UNAVAILABLE') as Error&{retryAt?:number};if(response.status===429){const seconds=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-now():60000;error.retryAt=now()+Math.max(1000,Number.isFinite(seconds)?seconds:60000);}throw error;}
  return readBoundedJson(response,1048576,'INVALID_OUTPUT',signal);
 }
 async function portfolio(source:TradeSourceRef,signal:AbortSignal){const p=await request(source,'/v2/portfolio',{},signal);if(p?.portfolioId!==source.sourceId||!Array.isArray(p.vaults))throw new Error('SOURCE_UNVERIFIED');return p;}
 async function loadOrder(source:TradeSourceRef,id:string,signal:AbortSignal,verifiedMetadata?:any){
  sourceSchema.parse(source);if(!/^[-\w]{1,128}$/.test(id))throw new Error('Invalid source order ID');
  const detail=await request(source,(source.kind==='flash'?'/v1':'/v2/portfolio')+'/orders/'+encodeURIComponent(id),source.kind==='flash'?{funderAddress:source.wallet}:{},signal);
  if(detail?.order?.orderId!==id)throw new Error('Order evidence mismatch');
  if(source.kind==='portfolio'){
   const metadata=verifiedMetadata??await portfolio(source,signal),vault=metadata.vaults.find((v:any)=>matches(v.address,source.wallet));
   if(!vault||typeof vault.vaultId!=='string'||detail.order.vaultId!==vault.vaultId)throw new Error('Order belongs to a different portfolio vault');
  }
  return normalizeTradeOrder(detail,source,now());
 }
 const order=(source:TradeSourceRef,id:string,signal:AbortSignal)=>loadOrder(source,id,signal);
 return {
  async validateBinding(binding:SourceBinding){
   sourceSchema.parse(binding.source);
   if(binding.source.kind==='portfolio'){
    const p=await portfolio(binding.source,AbortSignal.timeout(15000));
    if(!p.vaults.some((v:any)=>matches(v.address,binding.source.wallet)&&Array.isArray(v.signers)&&v.signers.some((a:any)=>matches(a,binding.trader))))throw new Error('SOURCE_UNVERIFIED');
   }else credentials(binding.source);
  },
  async page(source:TradeSourceRef,cursor:string|null,signal:AbortSignal):Promise<SourcePage>{
   sourceSchema.parse(source);if(cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>2048))throw new Error('Invalid cursor');
   const params:Record<string,string>=source.kind==='flash'?{funderAddress:source.wallet,pageSize:'50'}:{limit:'50'};
   if(cursor)params[source.kind==='flash'?'pageToken':'cursor']=cursor;
   const p=await request(source,(source.kind==='flash'?'/v1':'/v2/portfolio')+'/orders',params,signal);
   if(!Array.isArray(p?.orders)||p.orders.length>50)throw new Error('Invalid source page');
   const next=source.kind==='flash'?p.nextPageToken:p.hasNextPage===false?null:p.hasNextPage===true?p.nextCursor:undefined;
   if(!(next===null||typeof next==='string'&&next.length>0&&next.length<=2048)||next!==null&&next===cursor)throw new Error('Invalid source cursor');
   const metadata=source.kind==='portfolio'?await portfolio(source,signal):undefined;
   const vault=metadata?.vaults.find((v:any)=>matches(v.address,source.wallet));
   if(metadata&&!vault)throw new Error('SOURCE_UNVERIFIED');
   const orders:VerifiedOrder[]=[];
   for(const row of p.orders){signal.throwIfAborted();
    if(metadata){if(row.portfolioId!==source.sourceId)throw new Error('Portfolio page mismatch');if(typeof row.vaultId==='string'&&row.vaultId!==vault.vaultId)continue;}
    await pause(signal);orders.push(await loadOrder(source,text(row.orderId),signal,metadata));
   }
   return {orders,nextCursor:next,observedAt:now()};
  },order,
 };
}
export type TradeSource=ReturnType<typeof createTradeSource>;
