import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createDemoServer } from "../../src/features/builder/demo/server.mjs";
import { marketStrategy as rsiStrategy } from "../../src/features/builder/market/config.ts";
import {createMarketData} from "../../src/features/builder/market/data.ts";
import { createSyntheticCandles } from "../../src/features/builder/demo/replay.js";

let hits=0;
const candles=createSyntheticCandles(),time=candles.at(-1)!.closeTimeMs;
const word=(value:number)=>BigInt(value).toString(16).padStart(64,"0");
const round=(value:number)=>"0x"+[1,value,time/1000-7200,time/1000,1].map(word).join("");
function mockMarket(count=90,down=false) {
  return createMarketData({now:()=>time,fetcher:async(url,init)=>{
    if(String(url).includes("coinbase"))return Response.json(candles.slice(-count).map(c=>[c.openTimeMs/1000,c.low,c.high,c.open,c.close,10]));
    const price=candles.at(-1)!.close;
    if(String(url).includes("flash"))return Response.json({quoteId:"route-quote",side:"buy",orderType:"market",targetAsset:rsiStrategy.tokenOut,contraAsset:rsiStrategy.tokenIn,from:{asset:"contra",amount:"20"},to:{asset:"target",amount:"0.01",notional:String(price/100)}});
    return Response.json(JSON.parse(init!.body as string).map((call:any)=>({jsonrpc:"2.0",id:call.id,result:["0x2105","0x"+word(8),round(price*1e8),round(down?1:0),{number:"0x1234",timestamp:"0x"+(time/1000).toString(16)}][call.id-1]})));
  }});
}
const market=mockMarket();
const server=createDemoServer({market,fetcher:async()=>{hits++;throw new Error("Provider intentionally unavailable in offline route test");}});
let base:string;
before(async()=>{
  await market.refresh();
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  const address=server.address();assert.ok(address&&typeof address!=="string");base=`http://127.0.0.1:${address.port}`;
});
after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
const body=()=>({mode:"RULES_ONLY",strategy:rsiStrategy,initialCashUsd:1000,maxTurnoverUsd:2000,feeBps:10,slippageBps:25});
const post=(input=body(),headers={})=>fetch(`${base}/api/execution`,{method:"POST",headers:{"Content-Type":"application/json",Origin:base,...headers},body:JSON.stringify(input)});

test("paper replay uses historical candles checked by Chainlink and Flash without AI inference",async()=>{
  const response=await post();assert.equal(response.status,200);
  const payload=await response.json();assert.equal(payload.ok,true);assert.equal(payload.data.agentMode,"RULES_ONLY");
  assert.equal(payload.data.execution.mode,"PAPER");assert.ok(payload.data.execution.orders.length>0);
  assert.equal(payload.data.marketData.source,"COINBASE_ETH_USD");
  assert.equal(hits,0);
});
test("execution cannot forge server context, choose live mode or accept a live strategy",async()=>{
  for(const patch of [{candles:createSyntheticCandles()},{mode:"LIVE"},{context:{networkId:1}},{strategy:{...rsiStrategy,riskPolicy:{...rsiStrategy.riskPolicy,paperTradingOnly:false}}},{initialCashUsd:-1}]) {
    assert.equal((await post({...body(),...patch})).status,400);
  }
  assert.equal((await post(undefined,{Origin:"https://evil.invalid"})).status,403);
  assert.equal((await post({...body(),mode:"AI"})).status,401);
  assert.equal(hits,0);
});
test("paid agent failure is safe and local execution remains available afterwards",async()=>{
  const response=await post({...body(),mode:"AI"},{Authorization:"Bearer sk-route-test-only-key"});
  assert.equal(response.status,503);assert.equal(hits,1);
  assert.equal((await post()).status,200);
});
test("market data is read-only and does not expose Flash implementation or signing data",async()=>{
  const response=await fetch(`${base}/api/market`);assert.equal(response.status,200);
  const payload=await response.json();assert.equal(payload.data.source,"COINBASE_ETH_USD");
  assert.equal(payload.data.closedObservations,90);
  assert.ok(!JSON.stringify(payload).includes("dpka_"));assert.ok(!JSON.stringify(payload).includes("evm"));
  assert.equal((await fetch(`${base}/api/market`,{method:"POST"})).status,405);
  assert.equal((await fetch(`${base}/api/market`,{headers:{Origin:"https://evil.invalid"}})).status,403);
  assert.equal((await fetch(`${base}/core/market/flash.ts`)).status,404);
  assert.equal((await fetch(`${base}/core/market/config.ts`)).status,404);
});

test("server rejects RSI warm-up before making a paid inference request",async()=>{
  let inferenceCalls=0;
  const cold=mockMarket(2);
  await cold.refresh();
  const coldServer=createDemoServer({market:cold,fetcher:async()=>{inferenceCalls++;throw new Error("No inference before warm-up");}});
  await new Promise<void>(resolve=>coldServer.listen(0,"127.0.0.1",resolve));
  try {
    const address=coldServer.address();assert.ok(address&&typeof address!=="string");
    const response=await fetch(`http://127.0.0.1:${address.port}/api/execution`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer sk-warmup-test-only"},body:JSON.stringify({...body(),mode:"AI"})});
    assert.equal(response.status,400);assert.match((await response.json()).error.message,/historical one-minute candles/);
    assert.equal(inferenceCalls,0);
  } finally {await new Promise<void>(resolve=>coldServer.close(()=>resolve()));}
});
test("API harness does not expose browser or agent source modules",async()=>{
  for(const path of ["/replay.js","/execution.js"])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+"/core/execution/agent.ts")).status,404);
});

test("failed Chainlink checks block the route before any paid inference",async()=>{
  let inferenceCalls=0;
  const guarded=createDemoServer({market:mockMarket(90,true),fetcher:async()=>{inferenceCalls++;throw new Error("No inference permitted");}});
  await new Promise<void>(resolve=>guarded.listen(0,"127.0.0.1",resolve));
  try {
    const address=guarded.address();assert.ok(address&&typeof address!=="string");
    const response=await fetch(`http://127.0.0.1:${address.port}/api/execution`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer sk-oracle-test-only"},body:JSON.stringify({...body(),mode:"AI"})});
    assert.equal(response.status,503);assert.match((await response.json()).error.message,/sequencer/);assert.equal(inferenceCalls,0);
  } finally {await new Promise<void>(resolve=>guarded.close(()=>resolve()));}
});
