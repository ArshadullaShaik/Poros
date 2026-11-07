import assert from "node:assert/strict";
import {test} from "node:test";
import {createPriceMonitor} from "../../src/features/builder/execution/monitor.ts";
import {marketStrategy,marketContext} from "../../src/features/builder/market/config.ts";
import {validateStrategy} from "../../src/features/builder/validation/strategy.ts";
import {FlashError} from '../../src/features/builder/market/flash.ts';
const strategy=()=>({...structuredClone(marketStrategy),nodes:[{id:"price",type:"signal.price" as const,minPriceUsd:1900,maxPriceUsd:2100},{id:"risk",type:"guard.risk" as const},{id:"buy",type:"action.intent" as const,side:"BUY" as const,notionalUsd:20}],edges:[{id:"a",source:"price",target:"risk"},{id:"b",source:"risk",target:"buy"}]});
const limits={initialCashUsd:1000,maxTurnoverUsd:2000,feeBps:10,slippageBps:25};
function fixture() {
  let price=2200,time=100000,calls=0;
  const market={refresh:async()=>({source:"CHAINLINK_FLASH",priceUsd:price.toFixed(6),stale:false,observedAtMs:time}),read:()=>({priceUsd:price.toFixed(6),stale:false})};
  const monitor=createPriceMonitor({market,now:()=>time,invoke:async({execute}:any)=>{calls++;return {fill:execute(),inference:{model:"test"}};}});
  return {monitor,setPrice(value:number){price=value;time+=10000;},advance(){time+=61000;},get calls(){return calls;}};
}
test("live price range validates and rejects impossible bounds",()=>{
  assert.equal(validateStrategy(strategy(),marketContext).valid,true);
  const invalid=strategy();invalid.nodes[0].minPriceUsd=2200;
  assert.equal(validateStrategy(invalid,marketContext).valid,false);
});
test("monitor waits without inference then invokes execution once when price enters range",async()=>{
  const f=fixture(),run=f.monitor.start({strategy:strategy(),...limits,mode:"AI"});
  const waiting=await f.monitor.check(run.id,"sk-test-only-key");assert.equal(waiting.status,"WAITING");assert.equal(f.calls,0);
  f.setPrice(2000);const filled=await f.monitor.check(run.id,"sk-test-only-key");assert.equal(filled.orders.length,1);assert.equal(filled.status,"COMPLETED");assert.equal(f.calls,1);
  await f.monitor.check(run.id,"sk-test-only-key");assert.equal(f.calls,1);
  assert.ok(!JSON.stringify(filled).includes("sk-test"));
});
test("Stop and expiry prevent pending actions; unsupported candle rules never start",async()=>{
  const f=fixture(),run=f.monitor.start({strategy:strategy(),...limits,mode:"AI"});f.monitor.stop(run.id);
  assert.equal((await f.monitor.check(run.id,"sk-test-only-key")).status,"STOPPED");assert.equal(f.calls,0);
  const expired=f.monitor.start({strategy:strategy(),...limits,mode:"AI"});f.advance();await assert.rejects(f.monitor.check(expired.id,"sk-test-only-key"),/expired/);
  const rsi=strategy();rsi.nodes[0]={id:"price",type:"indicator.rsi",period:14,comparison:"lt",threshold:30} as any;
  assert.throws(()=>f.monitor.start({strategy:rsi,...limits,mode:"AI"}),/price/);
});
test("balances, fees, turnover and slippage are checked before an agent call",async()=>{
  for(const patch of [{initialCashUsd:10},{maxTurnoverUsd:10},{slippageBps:501}]){
    const f=fixture();f.setPrice(2000);
    try {const run=f.monitor.start({strategy:strategy(),...limits,...patch,mode:"AI"});await f.monitor.check(run.id,"sk-test-only-key");}catch{}
    assert.equal(f.calls,0);
  }
});
test('live runs reject zero slippage while paper runs allow it',()=>{
 const f=fixture();const input={strategy:{...strategy(),riskPolicy:{...strategy().riskPolicy,paperTradingOnly:false}},...limits,slippageBps:0,mode:'LIVE',wallet:'0x'+'a'.repeat(40)};
 assert.throws(()=>f.monitor.start(input),/positive.*slippage/i);
 assert.equal(f.monitor.start({...input,strategy:strategy(),mode:'RULES_ONLY'}).mode,'PAPER');
});
test('a rejected executable quote remains waiting with its actual price and never invokes the agent',async()=>{
 let invoked=0;
 const message='The executable Flash quote is outside the creator’s price range: $3378.980726 for a $0.200000 order.';
 const monitor=createPriceMonitor({market:{refresh:async()=>({priceUsd:'2000.000000',stale:false}),read:()=>({})},invoke:async()=>{invoked++;},orders:{prepare:async()=>{throw new FlashError(message);}}});
 const run=monitor.start({strategy:{...strategy(),riskPolicy:{...strategy().riskPolicy,paperTradingOnly:false}},...limits,mode:'LIVE',wallet:'0x'+'a'.repeat(40)});
 const result=await monitor.check(run.id,'sk-test-only-key');
 assert.equal(result.status,'WAITING');assert.equal(result.message,'Waiting: '+message);assert.equal(result.walletRequest,null);assert.equal(invoked,0);
});
