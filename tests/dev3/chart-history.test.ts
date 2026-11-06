import test from 'node:test';
import assert from 'node:assert/strict';
import {createChartHistory} from '../../src/features/builder/market/chart-history.ts';
const time=Date.parse('2026-11-06T12:00:00Z'),seconds=time/1000;
const rows=[[seconds-60,99,105,100,103,10],[seconds-180,98,104,101,100,5]];
test('historical chart loads closed one-minute OHLC, preserves gaps, and shares cached USD history across pairs',async()=>{
 let calls=0;
 const load=createChartHistory({now:()=>time,fetcher:async(input)=>{
  calls++;const url=new URL(String(input));assert.equal(url.hostname,'api.exchange.coinbase.com');assert.equal(url.searchParams.get('granularity'),'60');
  return Response.json(rows);
 }});
 const [a,b]=await Promise.all([load('eth-usdc'),load('eth-usdt')]);
 assert.equal(calls,1);assert.equal(a.candles.length,2);assert.equal(a.candles[1].time-a.candles[0].time,120000);
 assert.equal(a.source,'COINBASE');assert.equal(a.product,'ETH-USD');assert.equal(b.pairId,'eth-usdt');
 assert.deepEqual([a.candles[1].open,a.candles[1].high,a.candles[1].low,a.candles[1].close],[100,105,99,103]);
 await load('eth-usdc');assert.equal(calls,1);
});
test('historical candles reject malformed, inconsistent and duplicate data',async()=>{
 for(const data of [[...rows,rows[0]],[[seconds-60,99,105,110,103,10]],[[seconds-60,99,105,100,NaN,10]],[]]){
  const load=createChartHistory({now:()=>time,fetcher:async()=>Response.json(data)});
  await assert.rejects(load('eth-usdc'));
 }
 let calls=0;const load=createChartHistory({now:()=>time,fetcher:async()=>{calls++;return new Response(null,{status:404});}});
 await assert.rejects(load('eth-usdc'));assert.equal(calls,1);await assert.rejects(load('not-a-market'));assert.equal(calls,1);
});
