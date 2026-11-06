import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runPaperStrategy} from '../../src/features/builder/execution/paper.ts';
import {priceStrategy,marketContext} from '../../src/features/builder/market/config.ts';
import {summarizeBacktest,runHistoricalBacktest} from '../../src/features/builder/execution/backtest.ts';

const candles=(prices:number[])=>prices.map((close,i)=>({openTimeMs:i*86400000,closeTimeMs:(i+1)*86400000,open:close,high:close+1,low:close-1,close}));
const input=()=>({strategy:{...structuredClone(priceStrategy),nodes:priceStrategy.nodes.map(n=>n.type==='signal.price'?{...n,minPriceUsd:90,maxPriceUsd:110}:n)},context:marketContext,candles:candles([100,100,80,120]),initialCashUsd:100,maxTurnoverUsd:1000,feeBps:0,slippageBps:0});

test('canvas price rules fill at next open only once per action and cannot see later prices',()=>{
 const data=input(),result=runPaperStrategy(data);
 assert.equal(result.orders.length,1);
 assert.equal(result.orders[0]!.fillTimeMs,86400000);
 assert.equal(result.summary.finalValueUsd,'104.000000');
 const changed={...data,candles:candles([100,100,80,60])};
 assert.deepEqual(runPaperStrategy(changed).orders,result.orders);
 assert.deepEqual(runPaperStrategy(changed).equityCurve.slice(0,3),result.equityCurve.slice(0,3));
});

test('reports total return, initial-equity drawdown, costs and marked buy-and-hold without inventing closed trades',()=>{
 const data=input(),result=runPaperStrategy(data),report=summarizeBacktest(result,data.candles,data.initialCashUsd,0,0);
 assert.equal(report.totalReturnPct,4);
 assert.equal(report.maxDrawdownPct,4);
 assert.equal(report.buyAndHoldReturnPct,20);
 assert.equal(report.filledOrders,1);
 assert.equal(report.closedTrades,0);
 assert.equal(report.winRatePct,null);
 assert.equal(report.profitFactor,null);
 assert.equal(report.tradingCostsUsd,0);
});

test('a gap outside the execution range is rejected rather than filled and can recover at a later eligible price',()=>{
 const data=input();data.candles=candles([100,200,100,100]);
 const result=runPaperStrategy(data);
 assert.equal(result.orders.length,1);assert.equal(result.orders[0]!.fillTimeMs,3*86400000);
 assert.match(result.rejections[0]!.reason,/outside.*range/);
});

test('equity drawdown includes loss from initial capital and warm-up cannot trade before the requested start',()=>{
 const data=input();data.candles=candles([100,100,100,80]);
 const result=runPaperStrategy({...data,tradingStartTimeMs:2*86400000});
 assert.ok(result.orders.every(row=>row.fillTimeMs>=2*86400000));
 assert.equal(result.equityCurve.length,2);
 const report=summarizeBacktest({summary:{finalValueUsd:'80'},orders:[],equityCurve:[{valueUsd:'90'},{valueUsd:'80'}]} as any,candles([100,80]),100,0,0);
 assert.equal(report.maxDrawdownPct,20);
});

test('closed fill statistics include entry and exit fees and count flat exits separately',()=>{
 const result:any={summary:{finalValueUsd:'100'},equityCurve:[{valueUsd:'100'}],orders:[
 {side:'BUY',baseQuantity:'2',notionalUsd:'20',feeUsd:'2',priceUsd:'10',fillTimeMs:0},
 {side:'SELL',baseQuantity:'1',notionalUsd:'15',feeUsd:'1',priceUsd:'15',fillTimeMs:86400000},
 {side:'SELL',baseQuantity:'1',notionalUsd:'10',feeUsd:'1',priceUsd:'10',fillTimeMs:172800000},
 ]};
 const report=summarizeBacktest(result,candles([10,15,10]),100,0,0);
 assert.equal(report.closedTrades,2);
 assert.equal(report.winRatePct,50);
 assert.equal(report.profitFactor,1.5);
 assert.equal(report.realizedPnlUsd,1);
 assert.equal(report.tradingCostsUsd,4);
});

test('historical requests validate dates and fetch only server-selected products with complete coverage',async()=>{
 const start=Date.UTC(2025,0,1),end=start+3*86400000;
 let requests=0;
 const fetcher:any=async(url:URL)=>{requests++;assert.equal(url.hostname,'api.exchange.coinbase.com');assert.equal(url.pathname,'/products/ETH-USD/candles');return Response.json([2,1,0].map(i=>[start/1000+i*86400,99,101,100,100,1]));};
 const params={strategy:input().strategy,pairId:'eth-usdc',start:'2025-01-01',end:'2025-01-04',interval:86400,initialCashUsd:100,maxTurnoverUsd:1000,feeBps:0,slippageBps:0};
 const result=await runHistoricalBacktest(params,{fetcher,now:()=>end+86400000});
 assert.equal(result.execution.orders.length,1);
 assert.equal(result.dataSource.product,'ETH-USD');
 assert.equal(result.strategy.strategyId,params.strategy.strategyId);
 assert.ok(result.strategyHash.startsWith('0x'));
 await assert.rejects(()=>runHistoricalBacktest({...params,start:'2025-02-30'},{fetcher}),/date/i);
 await assert.rejects(()=>runHistoricalBacktest({...params,pairId:'btc-usdc'},{fetcher}),/market/i);
 await assert.rejects(()=>runHistoricalBacktest(params,{fetcher:async()=>Response.json([[start/1000,99,101,100,100,1]]) as any,now:()=>end+86400000}),/missing/i);
 assert.equal(requests,1);
});
