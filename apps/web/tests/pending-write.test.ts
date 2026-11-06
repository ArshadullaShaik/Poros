import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveUnsubmittedWrite, createPendingWriteChecker, type WriteCheckState } from '../src/pending-write.ts';
const key='common-ground.pending-write';
const pending={account:'0xabc',requestId:'ee6c6250-0000-4000-8000-000000046c7d',kind:'community',expected:{name:'myself'}};
function storage(){const values=new Map([[key,JSON.stringify(pending)]]);return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};}
test('recovery preserves the full old request before releasing the lock',()=>{
 const store=storage();archiveUnsubmittedWrite(store,pending,pending.account,true);
 assert.equal(store.getItem(key),null);
 const saved=JSON.parse(store.getItem(key+'.archive.'+pending.requestId)!);
 assert.deepEqual(saved.request,pending);assert.equal(saved.reason,'user-confirmed-no-transaction');
});
test('recovery refuses another account, stale intent, missing confirmation or submission evidence',()=>{
 for(const [snapshot,account,confirmed] of [[pending,'0xdef',true],[{...pending,requestId:'other'},pending.account,true],[pending,pending.account,false]] as const){
  const store=storage();assert.throws(()=>archiveUnsubmittedWrite(store,snapshot,account,confirmed));assert.ok(store.getItem(key));
 }
 for(const evidence of [{txHash:'0x123'},{entityKey:'0x456'}]){
  const store=storage();const request={...pending,...evidence};store.setItem(key,JSON.stringify(request));
  assert.throws(()=>archiveUnsubmittedWrite(store,request,pending.account,true));assert.ok(store.getItem(key));
 }
});
test('failed archival never discards the pending request',()=>{
 const store=storage();store.setItem=()=>{throw new Error('quota');};
 assert.throws(()=>archiveUnsubmittedWrite(store,pending,pending.account,true));assert.ok(store.getItem(key));
});

test('pending writes are checked immediately, back off while absent, and stop when verified', async () => {
 let time=0,calls=0,confirmed=false;
 const states:WriteCheckState[]=[];
 const tick=createPendingWriteChecker(async()=>{calls++;return confirmed;},(_request,state)=>states.push(state),()=>time);
 await tick('alice:request');
 assert.equal(calls,1);assert.equal(states.at(-1),'waiting');
 time=4999;await tick('alice:request');assert.equal(calls,1);
 time=5000;await tick('alice:request');assert.equal(calls,2);
 time=14999;await tick('alice:request');assert.equal(calls,2);
 confirmed=true;time=15000;await tick('alice:request');
 assert.equal(calls,3);assert.equal(states.at(-1),'verified');
 time=100000;await tick('alice:request');assert.equal(calls,3);
 await tick('alice:new-request');assert.equal(calls,4);
});

test('background checks pause when ineligible and never overlap during account or request changes', async () => {
 let release!:(confirmed:boolean)=>void,calls=0;
 const checked:string[]=[];
 const tick=createPendingWriteChecker(()=>{calls++;return new Promise<boolean>(resolve=>{release=resolve;});},request=>checked.push(request));
 await tick();assert.equal(calls,0);
 const first=tick('alice:request');
 await tick('alice:request');await tick('bob:request');assert.equal(calls,1);
 release(false);await first;
 const second=tick('bob:request');assert.equal(calls,2);
 release(true);await second;
 assert.deepEqual(checked,['alice:request','alice:request','bob:request','bob:request']);
});

test('network errors retry with a bounded delay while integrity conflicts require review', async () => {
 let time=0,calls=0,code='NETWORK_UNAVAILABLE';
 const states:WriteCheckState[]=[];
 const tick=createPendingWriteChecker(async()=>{calls++;throw {code};},(_request,state)=>states.push(state),()=>time);
 await tick('alice:request');assert.equal(states.at(-1),'retrying');
 for(const next of [5000,15000,35000,75000,135000]){time=next;await tick('alice:request');}
 assert.equal(calls,6);
 time=194999;await tick('alice:request');assert.equal(calls,6);
 code='INTEGRITY_FAILED';time=195000;await tick('alice:request');
 assert.equal(states.at(-1),'review');
 time=1000000;await tick('alice:request');assert.equal(calls,7);
});
