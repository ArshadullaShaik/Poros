import assert from "node:assert/strict";
import {test} from "node:test";
import {createMarketData} from "../../src/features/builder/market/data.ts";
import {marketStrategy} from "../../src/features/builder/market/config.ts";

const time=1800000000000;
const word=(n:number|bigint)=>BigInt(n).toString(16).padStart(64,"0");
const round=(answer:number,updated=time/1000,started=updated-7200)=>"0x"+[1,answer,started,updated,1].map(word).join("");
function fixture({rows=Array.from({length:100},(_,i)=>[time/1000-(i+1)*60,1999,2001,2000,2000,10]),oracle=round(200000000000),sequencer=round(0),chain="0x2105",flashPrice=2000}:any={}) {
  let clock=time,hits=0,fail=false;
  const fetcher=async(url:any,init:any)=>{
    hits++;
    if(fail)throw new Error("secret RPC credential");
    if(String(url).includes("coinbase"))return Response.json(rows);
    if(String(url).includes("flash"))return Response.json({quoteId:"test-quote",side:"buy",orderType:"market",targetAsset:marketStrategy.tokenOut,contraAsset:marketStrategy.tokenIn,from:{asset:"contra",amount:"20"},to:{asset:"target",amount:"0.01",notional:String(flashPrice/100)}});
    const calls=JSON.parse(init.body);
    return Response.json(calls.map((call:any)=>({jsonrpc:"2.0",id:call.id,result:[chain,"0x"+word(8),oracle,sequencer][call.id-1]})).reverse());
  };
  const market=createMarketData({fetcher,now:()=>clock});
  return {market,fail(){fail=true;},setTime(n:number){clock=n;},get hits(){return hits;}};
}
test("historical candles make RSI immediately ready with independent Chainlink and Flash provenance",async()=>{
  const f=fixture();
  await Promise.all([f.market.refresh(),f.market.refresh()]);assert.equal(f.hits,3);
  const snapshot=f.market.read();assert.equal(snapshot.source,"COINBASE_ETH_USD");assert.equal(snapshot.closedObservations,100);assert.equal(snapshot.stale,false);
  assert.equal(snapshot.chainlink?.priceUsd,"2000.000000");assert.equal(snapshot.flash?.quoteId,"test-quote");
  const candles=f.market.candlesFor(marketStrategy);assert.equal(candles.length,100);assert.equal(candles.at(-1)?.closeTimeMs,time);
  candles[0]!.close=1;assert.equal(f.market.candlesFor(marketStrategy)[0]!.close,2000);
  await f.market.refresh();assert.equal(f.hits,3);
  f.setTime(time+61000);assert.equal(f.market.read().stale,true);assert.throws(()=>f.market.candlesFor(marketStrategy),/stale/);
});
test("incomplete minute is excluded and missing minutes are never fabricated",async()=>{
  const rows=Array.from({length:20},(_,i)=>[time/1000-i*60,1999,2001,2000,2000,10]);rows.splice(5,1);
  const f=fixture({rows});await f.market.refresh();assert.equal(f.market.read().closedObservations,4);
  assert.throws(()=>f.market.candlesFor(marketStrategy),/historical/);
});
test("bad history, stale or invalid oracle, wrong chain, sequencer outage and deviation block execution",async()=>{
  for(const options of [
    {rows:[[time/1000-60,2001,1999,2000,2000,10]]},
    {rows:[[time/1000-600,1999,2001,2000,2000,10]]},
    {rows:[[time/1000+60,1999,2001,2000,2000,10]]},
    {oracle:round(0)},{oracle:round(200000000000,time/1000-1201)},
    {oracle:round(200000000000,time/1000+1)}, {oracle:"0x"},
    {chain:"0x1"},{sequencer:round(1)}, {sequencer:round(0,time/1000,time/1000-100)},
    {flashPrice:2200},{oracle:round(220000000000)},
  ]) {
    const f=fixture(options);await assert.rejects(f.market.refresh());assert.equal(f.market.read().stale,true);assert.throws(()=>f.market.candlesFor(marketStrategy));
  }
});
test("failed refresh invalidates previous readiness without disclosing upstream errors",async()=>{
  const market=createMarketData({fetcher:async()=>{throw new Error("secret RPC URL credential");}});
  await assert.rejects(market.refresh(),error=>!String(error).includes("secret"));
  const f=fixture();await f.market.refresh();f.setTime(time+61000);f.fail();
  await assert.rejects(f.market.refresh(),error=>!String(error).includes("secret"));
  assert.equal(f.market.read().stale,true);assert.throws(()=>f.market.candlesFor(marketStrategy));
});
