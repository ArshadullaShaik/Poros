import {readBoundedJson} from '../ai/zero-g.ts';
import {pairForStrategy} from './config.ts';
import {FlashError} from './flash.ts';
export function createChartHistory({fetcher=fetch,now=Date.now}={}) {
 const cache=new Map<string,{at:number;data:any}>(),pending=new Map<string,Promise<any>>();let active=0;
 return async (pairId:unknown) => {
  const pair=pairForStrategy(pairId),product=pair.base.reference+'-USD';
  if(!/^[A-Z0-9]{1,15}-USD$/.test(product))throw new FlashError('Historical chart data is unavailable for this market.');
  const saved=cache.get(product);let data=saved&&now()-saved.at<60000?saved.data:undefined;
  if(!data){
   let job=pending.get(product);
   if(!job){
    if(active>=2)throw new FlashError('Historical charts are busy. Live prices remain available.');
    active++;
    job=(async()=>{
     const end=Math.floor(now()/60000)*60000,start=end-3600000;
     const url=new URL('https://api.exchange.coinbase.com/products/'+product+'/candles');
     url.search=new URLSearchParams({start:new Date(start).toISOString(),end:new Date(end).toISOString(),granularity:'60'}).toString();
     const signal=AbortSignal.timeout(10000),response=await fetcher(url,{signal,redirect:'error',headers:{Accept:'application/json'}});
     if(!response.ok){void response.body?.cancel().catch(()=>{});throw new FlashError('Historical chart data is unavailable for this market.');}
     const rows=await readBoundedJson(response,65536,'INVALID_OUTPUT',signal);
     if(!Array.isArray(rows)||rows.length>300)throw new FlashError('Historical candle response is invalid.');
     const candles=new Map();
     for(const row of rows){
      if(!Array.isArray(row)||row.length!==6||row.some(v=>typeof v!=='number'||!Number.isFinite(v))||!Number.isSafeInteger(row[0]*1000)||row[0]%60!==0||row[5]<0)throw new FlashError('Historical candle response is invalid.');
      const [seconds,low,high,open,close]=row,time=seconds*1000;
      if(low<=0||high>1000000||low>high||open<low||open>high||close<low||close>high)throw new FlashError('Historical candle prices are invalid.');
      if(time<start||time>=end)continue;
      if(candles.has(time))throw new FlashError('Duplicate historical candle.');
      candles.set(time,{time,start:time,end:time+60000,open,high,low,close,source:'COINBASE'});
     }
     if(!candles.size)throw new FlashError('No recent historical candles are available.');
     const result={source:'COINBASE',product,candles:[...candles.values()].sort((a,b)=>a.time-b.time)};
     cache.set(product,{at:now(),data:result});if(cache.size>30)cache.delete(cache.keys().next().value!);
     return result;
    })().finally(()=>{active--;pending.delete(product);});
    pending.set(product,job);
   }
   data=await job;
  }
  return {...data,pairId:pair.id};
 };
}
