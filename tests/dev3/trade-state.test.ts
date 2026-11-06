import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTradeState} from '../../src/features/builder/server/trade-state.ts';
import {source,trader} from './trade-fixtures.ts';
test('source registrations and uncertain outbox writes survive restart; unlink retains attribution',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ledger-'));try{
  let state=openTradeState(join(dir,'state.sqlite'));state.link({trader,source,linkedAt:1000,historicalFrom:null});
  const input={schemaVersion:1 as const,kind:'order' as const,trader,source,observedAt:1000,data:{orderId:'one',status:'ORDER_STATUS_PENDING'}};
  const id=state.enqueue(input);state.markAttempt(id);state.close();state=openTradeState(join(dir,'state.sqlite'));
  assert.equal(state.outbox()[0]!.state,'uncertain');assert.equal(state.sources(trader).length,1);
  state.unlink(source,trader,2000);assert.equal(state.sources(trader)[0]!.active,false);assert.equal(state.outbox()[0]!.identity,id);
  assert.throws(()=>state.link({trader:'0x'+'b'.repeat(40),source,linkedAt:3000,historicalFrom:null}));state.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('worker leases exclude another owner until expiry and challenge consumption is atomic',()=>{
 const state=openTradeState(':memory:');try{
  assert.equal(state.lease('first',1000),true);assert.equal(state.lease('second',2000),false);assert.equal(state.lease('second',200000),true);
  const proof=state.challenge({trader,source,operation:'link',origin:'http://localhost:4325'},1000);
  assert.match(proof.message,/link/);assert.equal(state.consume(proof.nonce,2000).trader,trader);assert.throws(()=>state.consume(proof.nonce,2001));
 }finally{state.close();}
});
