import {createHash} from 'node:crypto';
import {readBoundedJson} from '../ai/zero-g.ts';
import {contextForPair,pairForStrategy} from '../market/config.ts';
import {validateStrategy} from '../validation/strategy.ts';
import {PaperError,runPaperStrategy,validatePaperInput} from './paper.ts';
import type {Candle} from './paper.ts';

export function summarizeBacktest(execution:ReturnType<typeof runPaperStrategy>,candles:Candle[],initial:number,feeBps:number,slippageBps:number){
 const round=(n:number)=>Math.round(n*1e6)/1e6;
 let peak=initial,drawdown=0,quantity=0,basis=0,gains=0,losses=0,wins=0,closed=0,fees=0,slippage=0;
 const opens=new Map(candles.map(c=>[c.openTimeMs,c.open]));
 for(const row of execution.equityCurve){const value=Number(row.valueUsd);peak=Math.max(peak,value);drawdown=Math.max(drawdown,(peak-value)/peak*100);}
 for(const fill of execution.orders){
   const qty=Number(fill.baseQuantity),value=Number(fill.notionalUsd),fee=Number(fill.feeUsd);
   fees+=fee;slippage+=qty*Math.abs(Number(fill.priceUsd)-(opens.get(fill.fillTimeMs)??Number(fill.priceUsd)));
   if(fill.side==='BUY'){quantity+=qty;basis+=value+fee;}
   else{const cost=basis*qty/quantity,pnl=round(value-fee-cost);closed++;if(pnl>0){wins++;gains+=pnl;}else losses-=pnl;quantity-=qty;basis-=cost;}
 }
 const entry=candles[0]!.open*(1+slippageBps/10000),benchmarkQuantity=Math.floor(initial/(1+feeBps/10000)/entry*1e8)/1e8;
 const spent=benchmarkQuantity*entry,benchmarkFinal=initial-spent-spent*feeBps/10000+benchmarkQuantity*candles.at(-1)!.close;
 return {totalReturnPct:round((Number(execution.summary.finalValueUsd)/initial-1)*100),maxDrawdownPct:round(drawdown),filledOrders:execution.orders.length,closedTrades:closed,
   winRatePct:closed?round(wins/closed*100):null,profitFactor:losses?round(gains/losses):null,noLosingTrades:closed>0&&losses===0&&gains>0,
   realizedPnlUsd:round(gains-losses),tradingCostsUsd:round(fees+slippage),feesUsd:round(fees),slippageCostUsd:round(slippage),buyAndHoldReturnPct:round((benchmarkFinal/initial-1)*100),
   benchmarkEquityCurve:candles.map(c=>({timeMs:c.closeTimeMs,valueUsd:round(initial-spent-spent*feeBps/10000+benchmarkQuantity*c.close)})),
   benchmark:'Unleveraged buy-and-hold from first open to last close, entry fees/slippage included; open holdings marked without a simulated exit.',tradeDefinition:'Each sell fill counts as one closed trade using average purchase cost including allocated entry fees. Open positions are excluded from win rate and profit factor.'};
}

export async function runHistoricalBacktest(input:any,{fetcher=fetch,now=Date.now,signal=AbortSignal.timeout(45000)}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['strategy','pairId','start','end','interval','initialCashUsd','maxTurnoverUsd','feeBps','slippageBps'].includes(key)))throw new PaperError('Send a strategy, market, historical dates and backtest limits only.');
 let pair,loaded;try{pair=pairForStrategy(input.pairId);loaded=pairForStrategy(input.strategy);}catch{throw new PaperError('Choose a supported historical market and valid loaded strategy.');}
 if(typeof input.pairId!=='string'||loaded.id!==pair.id)throw new PaperError('The backtest market must match the loaded strategy. Change the strategy market first.');
 const context=contextForPair(pair),checked=validateStrategy(input.strategy,context);
 if(!checked.valid)throw new PaperError('Load a valid strategy before backtesting.');
 if(!['USDC','USDT'].includes(pair.quote.reference)||!/^([A-Z0-9]{1,15})$/.test(pair.base.reference))throw new PaperError('Historical USD proxy is unavailable for this market.');
 const date=(text:unknown)=>{if(typeof text!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new PaperError('Choose valid historical dates.');const value=Date.parse(text+'T00:00:00.000Z');if(!Number.isFinite(value)||new Date(value).toISOString().slice(0,10)!==text)throw new PaperError('Choose real calendar dates.');return value;};
 const start=date(input.start),end=date(input.end),interval=input.interval;
 if(![60,300,900,3600,21600,86400].includes(interval)||start>=end||end>Math.floor(now()/(interval*1000))*interval*1000)throw new PaperError('Choose an ordered historical date range ending before the current incomplete candle.');
 const periods=input.strategy.nodes.filter((n:any)=>n.type==='indicator.rsi').map((n:any)=>n.period+1),warmup=Math.max(0,...periods),step=interval*1000,from=start-warmup*step;
 if(from<0||(end-from)/step>500)throw new PaperError('Choose at most 500 candles including RSI warm-up; use a larger interval for a longer date range.');
 const strategy={...structuredClone(input.strategy),riskPolicy:{...input.strategy.riskPolicy,paperTradingOnly:true}};
 const limits={strategy,context,initialCashUsd:input.initialCashUsd,maxTurnoverUsd:input.maxTurnoverUsd,feeBps:input.feeBps,slippageBps:input.slippageBps};
 validatePaperInput({...limits,candles:[{openTimeMs:start,closeTimeMs:start+step,open:1,high:1,low:1,close:1}]});
 const product=pair.base.reference+'-USD',candles:Candle[]=[];
 for(let cursor=from;cursor<end;){
   const until=Math.min(end,cursor+300*step),url=new URL('https://api.exchange.coinbase.com/products/'+product+'/candles');
   url.search=new URLSearchParams({start:new Date(cursor).toISOString(),end:new Date(until).toISOString(),granularity:String(interval)}).toString();
   let response;try{response=await fetcher(url,{signal,redirect:'error',headers:{Accept:'application/json'}});}catch{throw new PaperError('Historical prices could not be fetched. Try again.');}
   if(!response.ok){void response.body?.cancel().catch(()=>{});throw new PaperError('Historical data is unavailable for this market/date range.');}
   const rows=await readBoundedJson(response,262144,'INVALID_INPUT',signal);
   if(!Array.isArray(rows)||rows.length>301)throw new PaperError('Historical provider returned invalid candles.');
   const page=new Map<number,Candle>();
   for(const row of rows){
     if(!Array.isArray(row)||row.length!==6||row.some(v=>typeof v!=='number'||!Number.isFinite(v))||!Number.isSafeInteger(row[0]*1000)||row[0]*1000%step!==0)throw new PaperError('Historical provider returned invalid candles.');
     const openTimeMs=row[0]*1000;if(openTimeMs<cursor||openTimeMs>=until)continue;
     const candle={openTimeMs,closeTimeMs:openTimeMs+step,low:row[1],high:row[2],open:row[3],close:row[4]};
     if(page.has(openTimeMs))throw new PaperError('Historical prices contain duplicate candles.');page.set(openTimeMs,candle);
   }
   for(let time=cursor;time<until;time+=step){if(!page.has(time))throw new PaperError('Historical data has missing candles. Choose another range or interval; no prices were invented.');candles.push(page.get(time)!);}
   cursor=until;
 }
 const execution=runPaperStrategy({...limits,candles,tradingStartTimeMs:start}),tradingCandles=candles.filter(c=>c.openTimeMs>=start);
 return {mode:'BACKTEST',strategy:input.strategy,strategyHash:'0x'+createHash('sha256').update(JSON.stringify(input.strategy)).digest('hex'),parameters:{pairId:pair.id,start:input.start,end:input.end,interval,initialCashUsd:input.initialCashUsd,maxTurnoverUsd:input.maxTurnoverUsd,feeBps:input.feeBps,slippageBps:input.slippageBps},
   dataSource:{name:'Coinbase Exchange',product,proxyFor:pair.label+' on '+pair.network.name,candles:tradingCandles.length,warmupCandles:warmup,complete:true},execution,
   report:summarizeBacktest(execution,tradingCandles,input.initialCashUsd,input.feeBps,input.slippageBps),
   disclosure:'Historical spot USD prices are a proxy for the selected on-chain asset/stablecoin pair. USDC/USDT is modeled as USD 1. These are simulated fills, not historical Flash execution. End date is exclusive; dates use UTC. No gas or AI charges are modeled.'};
}
