import {readChainlink} from "./chainlink.ts";
import {createFlashMarket,FlashError} from "./flash.ts";
export function createLiveMarket({fetcher=fetch,now=Date.now}={}) {
  const flash=createFlashMarket({fetcher,now});
  let reference:Awaited<ReturnType<typeof readChainlink>>|undefined,checkedAt=-Infinity,lastAttempt=-Infinity,error:FlashError|undefined,pending:Promise<ReturnType<typeof read>>|undefined;
  function read() {
    const quote=flash.read();
    return {source:"CHAINLINK_FLASH" as const,chain:"base",pair:"WETH/USDC",priceUsd:reference?.priceUsd??null,observedAtMs:Number.isFinite(checkedAt)?checkedAt:null,
      stale:!!error||!reference||now()<checkedAt||now()-checkedAt>15000||now()-reference.updatedAtMs>1200000||quote.stale,
      chainlink:reference?{...reference}:null,flash:{quoteId:quote.quoteId,priceUsd:quote.priceUsd,observedAtMs:quote.observedAtMs},maxDeviationPercent:5};
  }
  async function collect() {
    try {
      const results=await Promise.allSettled([readChainlink({fetcher,now}),flash.refresh()]);
      for(const result of results)if(result.status==="rejected")throw result.reason;
      const answer=(results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof readChainlink>>>).value,quote=flash.read();
      if(quote.stale||!quote.priceUsd||Math.abs(Number(quote.priceUsd)/Number(answer.priceUsd)-1)>0.05)throw new FlashError("Flash differs from Chainlink by more than 5%. Execution is paused.");
      reference=answer;checkedAt=now();error=undefined;return read();
    } catch(cause){error=cause instanceof FlashError?cause:new FlashError("Live Chainlink or Flash data is unavailable.");throw error;}
  }
  function refresh(){
    if(pending)return pending;
    if(now()-lastAttempt<10000)return error?Promise.reject(error):Promise.resolve(read());
    lastAttempt=now();pending=collect().finally(()=>{pending=undefined;});return pending;
  }
  return {read,refresh};
}
