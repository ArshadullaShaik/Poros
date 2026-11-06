import {readChainlink} from "./chainlink.ts";
import {createFlashMarket,FlashError} from "./flash.ts";
import {pairForStrategy,tradingPairs,networks} from "./config.ts";
function readOracle(pair:ReturnType<typeof pairForStrategy>,token:ReturnType<typeof pairForStrategy>["base"],fetcher:typeof fetch,now:()=>number){
  const network=networks[(token.oracleNetwork??pair.network.oracleNetwork??pair.network.key) as keyof typeof networks]??pair.network;
  return readChainlink({fetcher,now,feed:token.feed,maxAgeSeconds:token.maxAgeSeconds,networkId:network.id,rpcUrl:network.key==="base"?process.env.BASE_RPC_URL??network.rpc:network.rpc,sequencer:"sequencer" in network?network.sequencer??null:null});
}
export function createLiveMarket({fetcher=fetch,now=Date.now,pair=pairForStrategy()}={}) {
  const flash=createFlashMarket({fetcher,now,pair});
  let reference:Awaited<ReturnType<typeof readChainlink>>|undefined,quoteReference:typeof reference,checkedAt=-Infinity,lastAttempt=-Infinity,error:FlashError|undefined,pending:Promise<ReturnType<typeof read>>|undefined;
  function read() {
    const quote=flash.read();
    return {source:"CHAINLINK_FLASH" as const,chain:pair.network.key,networkId:pair.network.id,pair:`${pair.base.symbol}/${pair.quote.symbol}`,pairId:pair.id,baseSymbol:pair.base.symbol,quoteSymbol:pair.quote.symbol,referenceSymbol:pair.base.reference,
      priceUsd:reference?.priceUsd??null,quotePriceUsd:quoteReference?.priceUsd??null,observedAtMs:Number.isFinite(checkedAt)?checkedAt:null,
      stale:!!error||!reference||!quoteReference||now()<checkedAt||now()-checkedAt>15000||now()-reference.updatedAtMs>pair.base.maxAgeSeconds*1000||now()-quoteReference.updatedAtMs>pair.quote.maxAgeSeconds*1000||quote.stale,
      chainlink:reference?{...reference}:null,quoteChainlink:quoteReference?{...quoteReference}:null,flash:{quoteId:quote.quoteId,priceUsd:quote.priceUsd,observedAtMs:quote.observedAtMs},maxDeviationPercent:5};
  }
  async function collect() {
    try {
      const results=await Promise.allSettled([readOracle(pair,pair.base,fetcher,now),readOracle(pair,pair.quote,fetcher,now),flash.refresh()]);
      for(const result of results)if(result.status==="rejected")throw result.reason;
      const answer=(results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof readChainlink>>>).value;
      const funding=(results[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof readChainlink>>>).value,quote=flash.read();
      if(quote.stale||!quote.priceUsd||Math.abs(Number(quote.priceUsd)/Number(answer.priceUsd)-1)>0.05)throw new FlashError("Flash differs from Chainlink by more than 5%. Execution is paused.");
      reference=answer;quoteReference=funding;checkedAt=now();error=undefined;return read();
    }catch(cause){error=cause instanceof FlashError?cause:new FlashError("Live Chainlink or Flash data is unavailable.");throw error;}
  }
  function refresh(){
    if(pending)return pending;
    if(now()-lastAttempt<10000)return error?Promise.reject(error):Promise.resolve(read());
    lastAttempt=now();pending=collect().finally(()=>{pending=undefined;});return pending;
  }
  async function chartPrice(){
    const quote=await flash.refresh();
    if(quote.stale||!quote.priceUsd||quote.observedAtMs===null)throw new FlashError("Fresh Flash chart quote is unavailable.");
    return {source:"FLASH" as const,pairId:pair.id,priceUsd:quote.priceUsd,stale:false as const,observedAtMs:quote.observedAtMs};
  }
  return {read,refresh,chartPrice};
}
export function createLiveMarkets(options:Parameters<typeof createLiveMarket>[0]={}){
  const markets=new Map(tradingPairs.map(pair=>[pair.id,createLiveMarket({...options,pair})]));
  const select=(input?:unknown)=>markets.get(pairForStrategy(input).id)!;
  const prices=new Map<string,{at:number|null;pending:Promise<{source:"CHAINLINK";pairId:string;priceUsd:string;stale:false;observedAtMs:number}>}>();
  const now=options.now??Date.now;
  function displayPrice(input?:unknown){
    const pair=pairForStrategy(input),cached=prices.get(pair.id);
    if(cached&&(cached.at===null||now()>=cached.at&&now()-cached.at<10000))return cached.pending;
    const pending=readOracle(pair,pair.base,options.fetcher??fetch,now).then(price=>({source:"CHAINLINK" as const,pairId:pair.id,priceUsd:price.priceUsd,stale:false as const,observedAtMs:price.updatedAtMs}));
    const entry={at:null as number|null,pending};
    prices.set(pair.id,entry);
    void pending.then(()=>{entry.at=now();},()=>{if(prices.get(pair.id)===entry)prices.delete(pair.id);});
    return pending;
  }
  async function chartPrice(input?:unknown){
    const market=select(input);
    try{return await market.chartPrice();}
    catch{return displayPrice(input);}
  }
  return {read:(input?:unknown)=>select(input).read(),refresh:(input?:unknown)=>select(input).refresh(),displayPrice,chartPrice};
}
