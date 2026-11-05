import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveUnsubmittedWrite } from '../src/pending-write.ts';
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
