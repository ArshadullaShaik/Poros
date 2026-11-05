import assert from "node:assert/strict";
import {test} from "node:test";
import {tradingPairs,strategyForPair,pairForStrategy,validatePriceStrategy} from "../../src/features/builder/market/config.ts";
import {createLiveMarkets} from "../../src/features/builder/market/live.ts";
import {createFlashOrders,validateWalletQuote} from "../../src/features/builder/execution/flash-orders.ts";

test("supported pairs use registered Base tokens, with BTC represented explicitly as cbBTC",()=>{
  assert.ok(tradingPairs.length>=4);
  for(const pair of tradingPairs){const strategy=strategyForPair(pair.id);assert.equal(validatePriceStrategy(strategy).valid,true);assert.equal(pairForStrategy(strategy).id,pair.id);}
  const btc=pairForStrategy(strategyForPair("btc-usdt"));assert.equal(btc.base.symbol,"cbBTC");assert.equal(btc.base.decimals,8);assert.equal(btc.quote.symbol,"USDT");
  assert.equal(validatePriceStrategy({...strategyForPair("btc-usdt"),tokenOut:"0x1111111111111111111111111111111111111111"}).valid,false);
  assert.throws(()=>strategyForPair("doge-usdt"));
});
test("pair price caches never return ETH data for a BTC request",async()=>{
  const time=1800000000000,calls:any[]=[];
  const word=(n:number)=>BigInt(n).toString(16).padStart(64,"0");const round=(n:number)=>"0x"+[1,n,time/1000-7200,time/1000,1].map(word).join("");
  const markets=createLiveMarkets({now:()=>time,fetcher:async(url:any,init:any)=>{
    const body=JSON.parse(init.body);calls.push(body);
    if(String(url).includes("flash")){const pair=tradingPairs.find(p=>p.base.address.toLowerCase()===body.targetAsset.toLowerCase()&&p.quote.address.toLowerCase()===body.contraAsset.toLowerCase())!;const price=pair.base.symbol==="cbBTC"?75000:2500;return Response.json({quoteId:"quote-"+pair.id,side:"buy",orderType:"market",targetAsset:body.targetAsset,contraAsset:body.contraAsset,from:{asset:"contra",amount:"20"},to:{asset:"target",amount:String(20/price),notional:"20"}});}
    return Response.json(body.map((call:any)=>({jsonrpc:"2.0",id:call.id,result:call.method==="eth_chainId"?"0x2105":call.params[0].data==="0x313ce567"?"0x"+word(8):call.params[0].to.toLowerCase()==="0xbcf85224fc0756b9fa45aa7892530b47e10b6433"?round(0):round(tradingPairs.some(p=>p.base.symbol==="cbBTC"&&p.base.feed.toLowerCase()===call.params[0].to.toLowerCase())?75000e8:tradingPairs.some(p=>p.quote.feed.toLowerCase()===call.params[0].to.toLowerCase())?1e8:2500e8)})));
  }});
  const eth=await markets.refresh("eth-usdc"),btc=await markets.refresh("btc-usdt");
  assert.equal(eth.priceUsd,"2500.000000");assert.equal(btc.priceUsd,"75000.000000");assert.equal(btc.pairId,"btc-usdt");assert.equal(btc.quotePriceUsd,"1.000000");
  assert.equal(markets.read(strategyForPair("eth-usdc")).pairId,"eth-usdc");
  const count=calls.length;await markets.refresh("btc-usdt");assert.equal(calls.length,count);
});
test("BTC sells use eight-decimal cbBTC quantities and USDT token/balance checks",async()=>{
  const pair=tradingPairs.find(p=>p.id==="btc-usdt")!,seen:any[]=[];
  const orders=createFlashOrders({fetcher:async(url:any,init:any)=>{const body=JSON.parse(init.body);seen.push({url:String(url),body});if(!String(url).includes("flash"))return Response.json({id:1,jsonrpc:"2.0",result:"0x"+"0".repeat(56)+"05f5e100"});return Response.json({});}});
  await assert.rejects(orders.prepare({action:{side:"SELL",notionalUsd:20},condition:{minPriceUsd:60000,maxPriceUsd:80000},funderAddress:"0x1111111111111111111111111111111111111111",priceUsd:"75000.000000",quotePriceUsd:"1.000000",maxSlippageBps:50,pairId:pair.id}));
  assert.equal(seen[0].body.params[0].to.toLowerCase(),pair.base.address.toLowerCase());
  assert.equal(seen[1].body.targetAsset,pair.base.address);assert.equal(seen[1].body.contraAsset,pair.quote.address);assert.equal(seen[1].body.qty,"0.00026666");
});

test("a fixed BTC sell amount cannot exceed its USD cap after price increases",async()=>{
  let requests=0;
  const orders=createFlashOrders({fetcher:async()=>{requests++;throw new Error("No quote or submission permitted");}});
  const prepared={order:{side:"sell",qty:"0.00033333",targetAsset:tradingPairs[3].base.address,contraAsset:tradingPairs[3].quote.address},notionalUsd:"20.000000",quotePriceUsd:"1.000000",basePriceUsd:"60000.000000"};
  await assert.rejects(orders.revalidate(prepared,{minPriceUsd:60000,maxPriceUsd:70000},undefined,"1.000000","66000.000000"),/USD order cap/);
  assert.equal(requests,0);
});

test("changing pairs preserves existing risk limits and rules while replacing the token allowlist",()=>{
  const previous=strategyForPair("eth-usdc");previous.riskPolicy.maxSlippageBps=10;previous.riskPolicy.maxNotionalUsd=10;previous.riskPolicy.paperTradingOnly=false;
  const next=strategyForPair("btc-usdt",previous);
  assert.equal(next.riskPolicy.maxSlippageBps,10);assert.equal(next.riskPolicy.maxNotionalUsd,10);assert.equal(next.riskPolicy.paperTradingOnly,false);assert.deepEqual(next.nodes,previous.nodes);
  assert.deepEqual(next.riskPolicy.allowlistedTokenAddresses,[next.tokenIn,next.tokenOut]);assert.notEqual(next.strategyId,previous.strategyId);
});

test('AMP display reads a fresh Chainlink price without requiring a Flash route; execution still requires Flash',async()=>{
 const time=1800000000000,word=(n:number)=>BigInt(n).toString(16).padStart(64,'0');let calls=0,stale=false;
 const markets=createLiveMarkets({now:()=>time,fetcher:async(url:any,init:any)=>{
  calls++;
  if(String(url).includes('flash'))return Response.json({error:'No route'},{status:400});
  return Response.json(JSON.parse(init.body).map((call:any)=>({jsonrpc:'2.0',id:call.id,result:call.method==='eth_chainId'?'0x2105':call.params[0].data==='0x313ce567'?'0x'+word(8):'0x'+[1,call.params[0].to.toLowerCase()==='0xbcf85224fc0756b9fa45aa7892530b47e10b6433'?0:120000,time/1000-7200,time/1000-(stale?90000:0),1].map(word).join('')})));
 }});
 const price=await markets.displayPrice('base-amp-usdc');assert.equal(price.source,'CHAINLINK');assert.equal(price.priceUsd,'0.001200');assert.equal(calls,1);
 await markets.displayPrice('base-amp-usdc');assert.equal(calls,1);
 await assert.rejects(markets.refresh('base-amp-usdc'),/HTTP 400/);assert.equal(markets.read('base-amp-usdc').stale,true);
 stale=true;await assert.rejects(markets.displayPrice('eth-usdc'));
});
