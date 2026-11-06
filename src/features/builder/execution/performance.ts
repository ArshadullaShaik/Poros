import {readBoundedJson} from '../ai/zero-g.ts';
import {FlashError} from '../market/flash.ts';
const text=(value:unknown):string=>{
  if(typeof value!=='string'||!value.length||value.length>128)throw new FlashError('Invalid Flash history.');
  return value;
};
export function validHistoryWallet(value:unknown):value is string {
  return typeof value==='string' && (/^0x[0-9a-f]{40}$/i.test(value) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value));
}
function amount(value:unknown){
  if(typeof value!=='string'||!/^\d{1,18}(?:\.\d{1,36})?$/.test(value))throw new FlashError('Invalid Flash fill amount.');
  const [whole,fraction='']=value.split('.');return BigInt(whole+fraction.padEnd(36,'0'));
}
function decimal(value:bigint){
  const sign=value<0n?'-':'';const raw=(value<0n?-value:value).toString().padStart(37,'0');
  return sign+raw.slice(0,-36)+(raw.slice(-36).replace(/0+$/,'')?'.'+raw.slice(-36).replace(/0+$/,''):'');
}
function asset(value:any){
  const chain=text(value?.chain?.namespace)+':'+text(value?.chain?.id);
  const address=text(value?.address);
  return {key:chain+':'+(chain.startsWith('eip155:')?address.toLowerCase():address),ticker:text(value?.ticker),chain:text(value?.chain?.name)};
}
export function summarizeFlashFills(details:any[],wallet:string,complete:boolean){
  const markets=new Map<string,{market:string;chain:string;currency:string;quantity:bigint;basis:bigint;pnl:bigint;unknown:boolean;sells:number}>();
  const fills:{key:string;side:string;quantity:bigint;value:bigint;fee:bigint;time:number;id:string;orderId:string;transactionId:string;pnl:bigint|null}[]=[];
  const seen=new Set<string>();
  for(const {order,fills:rows} of details){
    const matches=(address:unknown)=>typeof address==='string' && (/^0x/i.test(wallet)?address.toLowerCase()===wallet.toLowerCase():address===wallet);
    if(!matches(order?.funderAddress)||order.recipientAddress&&!matches(order.recipientAddress)||!['buy','sell'].includes(order.side)||!Array.isArray(rows)||rows.length>1000)throw new FlashError('Flash history does not match this wallet.');
    const base=asset(order.targetAsset),quote=asset(order.contraAsset),key=base.key+'/'+quote.key;
    for(const fill of rows){
      if(fill.status!=='CHAIN_STATUS_FINALIZED')continue;
      if(fill.rootOrderId!==order.orderId)throw new FlashError('Flash fill belongs to another order.');
      const id=text(fill.orderId)+':'+text(fill.transactionId);
      if(seen.has(id))continue;
      const quantity=amount(fill.targetAmount),value=amount(fill.contraAmount),fee=amount(fill.feeNotional),time=Date.parse(fill.filledAt);
      if(quantity<=0n||value<=0n||!Number.isSafeInteger(time))throw new FlashError('Invalid finalized fill.');
      seen.add(id);
      if(!markets.has(key))markets.set(key,{market:base.ticker+' / '+quote.ticker,chain:base.chain,currency:quote.ticker,quantity:0n,basis:0n,pnl:0n,unknown:!complete,sells:0});
      fills.push({key,side:order.side,quantity,value,fee,time,id,orderId:text(order.orderId),transactionId:text(fill.transactionId),pnl:null});
    }
  }
  let fees=0n;
  fills.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  // Same-time opposing fills have no reliable execution order in this response.
  const times=new Map<string,string>();
  for(const fill of fills){
    const market=markets.get(fill.key)!;const at=fill.key+':'+fill.time;
    if(times.has(at)&&times.get(at)!==fill.side)market.unknown=true;
    times.set(at,fill.side);fees+=fill.fee;
    if(fill.side==='buy'){market.quantity+=fill.quantity;market.basis+=fill.value;}
    else{
      market.sells++;
      if(fill.quantity>market.quantity){market.unknown=true;market.quantity=0n;market.basis=0n;}
      else{const cost=market.basis*fill.quantity/market.quantity;fill.pnl=fill.value-cost;market.pnl+=fill.pnl;market.quantity-=fill.quantity;market.basis-=cost;}
    }
  }
  return {complete,fills:fills.length,feesUsd:decimal(fees),markets:[...markets.values()].map(row=>({market:row.market,chain:row.chain,currency:row.currency,realizedPnl:row.unknown?null:decimal(row.pnl),openQuantity:decimal(row.quantity),sells:row.sells})),
    transactions:fills.map(fill=>{
      const market=markets.get(fill.key)!;
      return {orderId:fill.orderId,transactionId:fill.transactionId,market:market.market,chain:market.chain,currency:market.currency,side:fill.side.toUpperCase(),quantity:decimal(fill.quantity),value:decimal(fill.value),feeUsd:decimal(fill.fee),filledAt:fill.time,realizedPnl:market.unknown||fill.pnl===null?null:decimal(fill.pnl)};
    }).reverse(),
  };
}
export function createFlashPerformance({fetcher=fetch,apiKey=process.env.FLASH_API_KEY??'dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b',pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)),now=Date.now}={}){
  const cache=new Map<string,{expires:number;result:Promise<ReturnType<typeof summarizeFlashFills>>}>();
  let busy=false;
  async function read(wallet:string){
    if(!validHistoryWallet(wallet))throw new FlashError('Connect a wallet to read Flash performance.');
    if(/^0x/i.test(wallet))wallet=wallet.toLowerCase();
    const saved=cache.get(wallet);if(saved&&saved.expires>now())return saved.result;
    if(busy)throw new FlashError('History is being refreshed. Try again shortly.');
    busy=true;
    const result=(async()=>{
      const signal=AbortSignal.timeout(45000);
      async function request(path:string){
        const response=await fetcher('https://flash.definitive.fi/v1'+path,{method:'GET',headers:{'x-definitive-api-key':apiKey},redirect:'error',signal});
        if(!response.ok){void response.body?.cancel().catch(()=>{});throw new FlashError('Flash history is unavailable. Try again shortly.');}
        return readBoundedJson(response,1048576,'INVALID_OUTPUT',signal);
      }
      // shortcut: bounded recent history; suppress P/L when older orders exist rather than invent cost basis.
      const page=await request('/orders?funderAddress='+encodeURIComponent(wallet)+'&pageSize=50');
      if(!Array.isArray(page?.orders)||page.orders.length>50||!(page.nextPageToken===null||typeof page.nextPageToken==='string'))throw new FlashError('Invalid Flash order history.');
      const details=[];const ids=new Set<string>();
      for(const order of page.orders){
        const id=text(order.orderId);if(!/^[-\w]{1,128}$/.test(id))throw new FlashError('Invalid Flash order ID.');
        if(ids.has(id))continue;ids.add(id);
        await pause(250);
        const detail=await request('/orders/'+encodeURIComponent(id));
        if(detail?.order?.orderId!==id)throw new FlashError('Flash returned a different order.');
        details.push(detail);
      }
      return summarizeFlashFills(details,wallet,page.nextPageToken===null);
    })();
    cache.set(wallet,{expires:now()+30000,result});
    if(cache.size>20)cache.delete(cache.keys().next().value!);
    try{return await result;}catch(error){cache.delete(wallet);throw error;}finally{busy=false;}
  }
  return read;
}
