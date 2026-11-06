import assert from "node:assert/strict";
import {test} from "node:test";
import {interpretCreatorStrategy} from "../../src/features/builder/ai/interpreter.ts";
import {createDemoServer} from "../../src/features/builder/demo/server.mjs";
import {priceStrategy} from "../../src/features/builder/market/config.ts";
import {createLiveMarket} from "../../src/features/builder/market/live.ts";
const key="sk-live-flow-test-only",model="qwen3.7-flash";
const catalog={data:[{id:model,type:"chatbot",provider_count:1,context_length:32768,architecture:{input_modalities:["text"],output_modalities:["text"]},supported_formats:["openai"],supported_parameters:["tools","response_format","max_tokens"],pricing:{prompt:"1",completion:"2"},pricing_usd:{prompt:"0.00000001",completion:"0.00000002"}}]};
const ready={status:"READY",pairId:"eth-usdc",rules:[{minPriceUsd:2000,maxPriceUsd:2100,side:"BUY",notionalUsd:20}],questions:[]};
function transport(result:any=ready){
  const calls:any[]=[];
  const fetcher=async(url:any,init:any)=>{calls.push({url,body:init?.body});if(String(url).endsWith("/models"))return Response.json(catalog);return Response.json({model,choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]});};
  return {fetcher,calls};
}
test("interpreter translates text into validated rules without accepting executable code or market changes",async()=>{
  const f=transport(),result=await interpretCreatorStrategy({apiKey:key,name:"Creator",text:"Buy $20 WETH once between $2000 and $2100 inclusive."},f.fetcher);
  assert.equal(result.status,"READY");assert.equal(result.strategy?.nodes[0]?.type,"signal.price");assert.equal(result.strategy?.networkId,8453);assert.equal(result.strategy?.riskPolicy.maxNotionalUsd,20);
  assert.ok(!JSON.stringify(f.calls).includes(key));assert.equal(f.calls.length,2);
  for(const invalid of [ {...ready,rules:[{...ready.rules[0],code:"sendTransaction()"}]},{...ready,rules:[{...ready.rules[0],notionalUsd:999}]},{...ready,rules:[{...ready.rules[0],minPriceUsd:2200}]},{...ready,rules:[{...ready.rules[0],side:"TRANSFER"}]}])await assert.rejects(interpretCreatorStrategy({apiKey:key,name:"Creator",text:"instructions"},transport(invalid).fetcher));
  const question=await interpretCreatorStrategy({apiKey:key,name:"Creator",text:"Buy when cheap"},transport({status:"NEEDS_CLARIFICATION",questions:["Which target and amount?"]}).fetcher);
  assert.equal(question.strategy,undefined);
});
test("live market has no candle request or warm-up",async()=>{
  const time=1800000000000,urls:string[]=[];
  const word=(n:number)=>BigInt(n).toString(16).padStart(64,"0");
  const round=(answer:number)=>"0x"+[1,answer,time/1000-7200,time/1000,1].map(word).join("");
  const market=createLiveMarket({now:()=>time,fetcher:async(url:any,init:any)=>{
    urls.push(String(url));
    if(String(url).includes("flash"))return Response.json({quoteId:"live-quote",side:"buy",orderType:"market",targetAsset:priceStrategy.tokenOut,contraAsset:priceStrategy.tokenIn,from:{asset:"contra",amount:"20"},to:{asset:"target",amount:"0.01",notional:"20"}});
    return Response.json(JSON.parse(init.body).map((call:any)=>({jsonrpc:"2.0",id:call.id,result:["0x2105","0x"+word(8),round(call.params?.[0]?.to?.toLowerCase()==="0x1550207eaeb590d1557a6e6c066d3d57b5a4dc65"?100000000:200000000000),round(0)][call.id-1]})));
  }});
  const result=await market.refresh();assert.equal(result.source,"CHAINLINK_FLASH");assert.equal(result.stale,false);assert.equal(result.priceUsd,"2000.000000");
  assert.equal(urls.length,3);assert.ok(urls.every(url=>!url.includes("coinbase")&&!url.includes("candle")));
});
test("text-to-live-monitor HTTP flow waits without AI, stops, rejects forged data and keeps private modules private",async()=>{
  let price=2500,calls=0;
  const market={refresh:async()=>market.read(),read:()=>({source:"CHAINLINK_FLASH",priceUsd:price.toFixed(6),stale:false})};
  const fake=transport();
  const server=createDemoServer({market,fetcher:async(...args:any[])=>{calls++;return fake.fetcher(...args);}});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address=server.address();assert.ok(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}`;
    const post=async(path:string,body:any,headers:any={})=>{const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`,...headers},body:JSON.stringify(body)});return {response,payload:await response.json()};};
    const interpreted=await post("/api/interpret",{text:"Buy $20 once between $2000 and $2100 inclusive",name:"Purchased creator strategy"});
    assert.equal(interpreted.response.status,200);assert.equal(interpreted.payload.data.status,"READY");assert.equal(calls,2);
    const config={action:"start",mode:"AI",strategy:interpreted.payload.data.strategy,initialCashUsd:1000,maxTurnoverUsd:2000,feeBps:10,slippageBps:25};
    const started=await post("/api/monitor",config),id=started.payload.data.id;
    assert.equal(started.response.status,200);
    const waiting=await post("/api/monitor",{action:"check",id});assert.equal(waiting.payload.data.status,"WAITING");assert.equal(calls,2);
    const stopped=await post("/api/monitor",{action:"stop",id});assert.equal(stopped.payload.data.status,"STOPPED");
    assert.equal((await post("/api/monitor",{...config,candles:[]})).response.status,400);
    assert.equal((await post("/api/monitor",config,{Origin:"https://evil.invalid"})).response.status,403);
    assert.equal((await fetch(base+"/core/ai/interpreter.ts")).status,404);
    assert.equal((await fetch(base+"/core/execution/monitor.ts")).status,404);
    assert.equal((await post("/api/execution",config)).response.status,400);
    price=2050;
    const local=await post("/api/monitor",{...config,mode:"RULES_ONLY"});
    const filled=await post("/api/monitor",{action:"check",id:local.payload.data.id});assert.equal(filled.payload.data.orders.length,1);assert.equal(filled.payload.data.status,"COMPLETED");assert.equal(calls,2);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test("interpreter chooses the registered BTC/USDT pair and rejects an unknown market",async()=>{
  const result=await interpretCreatorStrategy({apiKey:key,name:"BTC creator",text:"Buy $20 cbBTC with USDT on Base once between $60000 and $70000 USD inclusive."},transport({...ready,pairId:"btc-usdt",rules:[{...ready.rules[0],minPriceUsd:60000,maxPriceUsd:70000}]}).fetcher);
  assert.equal(result.strategy?.tokenIn.toLowerCase(),"0xfde4c96c8593536e31f229ea8f37b2ada2699bb2");
  assert.equal(result.strategy?.tokenOut.toLowerCase(),"0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf");
  await assert.rejects(interpretCreatorStrategy({apiKey:key,name:"Unsupported",text:"Trade another token"},transport({...ready,pairId:"unknown-usdt"}).fetcher),{code:"INVALID_OUTPUT"});
});

test('a failed market refresh returns an error without committing success headers or killing the server',async()=>{
  const {FlashError}=await import('../../src/features/builder/market/flash.ts');
  const server=createDemoServer({market:{read:()=>({}),refresh:async()=>{throw new FlashError('Feed is temporarily unavailable.');}}});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;const response=await fetch(base+'/api/market');assert.equal(response.status,503);assert.equal((await response.json()).ok,false);assert.equal((await fetch(base+'/api/monitor')).status,405);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
