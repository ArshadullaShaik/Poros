import test from 'node:test';
import assert from 'node:assert/strict';
import {createPriceMonitor} from '../../src/features/builder/execution/monitor.ts';
import {priceStrategy} from '../../src/features/builder/market/config.ts';
test('missing recording configuration blocks live runs before wallet approval but allows paper runs',()=>{
 const monitor=createPriceMonitor({market:{read:()=>({})},tradeLedger:()=>undefined});
 const input={strategy:{...priceStrategy,riskPolicy:{...priceStrategy.riskPolicy,paperTradingOnly:false}},mode:'LIVE',wallet:'0x'+'a'.repeat(40),initialCashUsd:1000,maxTurnoverUsd:1000,feeBps:0,slippageBps:25};
 assert.throws(()=>monitor.start(input),/ARKIV_TRADE_WRITER_PRIVATE_KEY.*ARKIV_TRADE_TRUSTED_WRITER.*TRADE_LEDGER_DB_PATH.*TRADE_LEDGER_ORIGIN/);
 const paper=monitor.start({...input,strategy:priceStrategy,mode:'RULES_ONLY'});
 assert.equal(paper.mode,'PAPER');
});
test('accepted live order is never resubmitted when recording its acceptance fails',async()=>{
 const time=1800000000000;let submitted=0,tracked=0;
 const recorder={trackSubmission(input:any){tracked++;if(input.orderId)throw new Error('disk failed');return 'intent';},recordingState(){return {state:'pending',message:'Pending'};}};
 const market={refresh:async()=>({priceUsd:'2050.000000',stale:false,observedAtMs:time}),read:()=>({priceUsd:'2050.000000',stale:false})};
 const monitor=createPriceMonitor({market,now:()=>time,tradeLedger:()=>recorder,invoke:async({execute}:any)=>({fill:await execute(),inference:{}}),orders:{prepare:async()=>({quoteId:'quote',side:'BUY',deadlineMs:time+300000,notionalUsd:'20',effectivePriceUsd:'2050'}),revalidate:async()=>{},submit:async()=>{submitted++;return 'accepted';},status:async()=>'ORDER_STATUS_PENDING'}});
 const run=monitor.start({strategy:{...priceStrategy,riskPolicy:{...priceStrategy.riskPolicy,paperTradingOnly:false}},mode:'LIVE',wallet:'0x'+'a'.repeat(40),initialCashUsd:1000,maxTurnoverUsd:1000,feeBps:0,slippageBps:25});
 await monitor.check(run.id,'sk-test-only-key');const accepted=await monitor.submit(run.id,'0x'+'a'.repeat(130));
 assert.equal(accepted.liveOrders[0].orderId,'accepted');assert.equal(accepted.recording.state,'delayed');assert.equal(tracked,2);
 await assert.rejects(monitor.submit(run.id,'0x'+'a'.repeat(130)));assert.equal(submitted,1);
});
