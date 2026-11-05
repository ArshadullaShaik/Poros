import assert from "node:assert/strict";
import {test} from "node:test";
import {createFlashMarket} from "../../src/features/builder/market/flash.ts";
import {marketStrategy} from "../../src/features/builder/market/config.ts";

const quote=(price="2000",patch={})=>({quoteId:"quote-test",side:"buy",orderType:"market",targetAsset:"0x4200000000000000000000000000000000000006",contraAsset:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",from:{asset:"contra",amount:"20",notional:"20"},to:{asset:"target",amount:"0.01",notional:String(Number(price)/100)},...patch});

test("Flash reads only a fixed market quote and returns no signing payload or key",async()=>{
  let sent:any;const key="dpka-test-private";
  const market=createFlashMarket({apiKey:key,now:()=>60000,fetcher:async(url,init)=>{sent={url,init};return Response.json(quote("2000",{evm:{secret:"signing payload"}}));}});
  const data=await market.refresh();
  assert.equal(sent.url,"https://flash.definitive.fi/v1/quote");
  assert.equal(sent.init.headers["x-definitive-api-key"],key);
  const body=JSON.parse(sent.init.body);
  assert.equal(body.qty,"20");assert.equal(body.targetChain,"base");assert.equal(body.side,"buy");
  assert.equal(body.funderAddress,undefined);
  assert.equal(data.priceUsd,"2000.000000");
  assert.equal(data.source,"DEFINITIVE_FLASH");assert.equal(data.closedObservations,0);
  assert.ok(!JSON.stringify(data).includes(key));assert.ok(!JSON.stringify(data).includes("signing payload"));
  assert.throws(()=>market.candlesFor({...marketStrategy,tokenIn:marketStrategy.tokenOut,tokenOut:marketStrategy.tokenIn}),/Base WETH\/USDC/);
});

test("quote observations aggregate only completed minutes and enforce RSI warm-up",async()=>{
  let time=0,price="2000",calls=0;
  const market=createFlashMarket({now:()=>time,fetcher:async()=>{calls++;return Response.json(quote(price));}});
  await market.refresh();time=10000;price="2100";await market.refresh();
  time=20000;price="1900";await market.refresh();
  assert.throws(()=>market.candlesFor(marketStrategy),/observations/);
  const strategy=structuredClone(marketStrategy);
  strategy.nodes.forEach(node=>{if(node.type==="indicator.rsi")node.period=2;});
  for(time=60000;time<=240000;time+=60000)await market.refresh();
  time=240000;
  const candles=market.candlesFor(strategy);
  assert.equal(candles.length,4);
  assert.deepEqual(candles[0],{openTimeMs:0,closeTimeMs:60000,open:2000,high:2100,low:1900,close:1900});
  assert.ok(candles.every(candle=>candle.closeTimeMs<=time));
  assert.equal(calls,7);
  candles[0].close=1;
  assert.equal(market.candlesFor(strategy)[0].close,1900);
});

test("Flash requests are cached and concurrent consumers share one quote",async()=>{
  let calls=0,release:Function;
  const market=createFlashMarket({now:()=>1000,fetcher:async()=>{calls++;await new Promise(resolve=>{release=resolve;});return Response.json(quote());}});
  const first=market.refresh(),second=market.refresh();release!();await Promise.all([first,second]);
  await market.refresh();assert.equal(calls,1);
});

test("missing quote minutes reset history instead of inventing candles",async()=>{
  let time=0;
  const market=createFlashMarket({now:()=>time,fetcher:async()=>Response.json(quote())});
  await market.refresh();time=180000;await market.refresh();
  assert.equal(market.read().closedObservations,0);
  assert.throws(()=>market.candlesFor(marketStrategy),/observations/);
  time=300000;assert.equal(market.read().stale,true);
  assert.throws(()=>market.candlesFor(marketStrategy),/stale/);
});

test("malformed and wrong-market quotes cannot enter the price history",async()=>{
  for(const response of [quote("0"),quote("2000",{targetAsset:"wrong"}),quote("2000",{side:"sell"}),quote("2000",{from:{asset:"contra",amount:"200",notional:"200"}}),quote("2000",{to:{asset:"target",amount:"0",notional:"20"}})]) {
    const market=createFlashMarket({fetcher:async()=>Response.json(response)});
    await assert.rejects(market.refresh(),{code:"FLASH_UNAVAILABLE"});
    assert.equal(market.read().priceUsd,null);
  }
});

test("provider errors do not expose credentials or substitute synthetic data",async()=>{
  let time=0,fail=false;
  const key="dpka-private-test";
  const market=createFlashMarket({apiKey:key,now:()=>time,fetcher:async()=>fail?new Response(key,{status:502}):Response.json(quote())});
  await market.refresh();time=10000;fail=true;
  await assert.rejects(market.refresh(),error=>error.code==="FLASH_UNAVAILABLE"&&!error.message.includes(key));
  assert.equal(market.read().closedObservations,0);
  assert.equal(market.read().priceUsd,"2000.000000");
});
