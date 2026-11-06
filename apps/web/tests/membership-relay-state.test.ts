import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
test('relay jobs keep immutable encrypted input and exact signed transaction through retries',()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));
 try{
  const job={kind:'publish',owner:'owner',id:'id',payload:{content:'private'}};
  state.enqueue(job);assert.throws(()=>state.enqueue({...job,payload:{content:'different'}}));
  assert.equal(state.lease('worker',1000),true);assert.equal(state.lease('other',1001),false);
  state.updateJob('publish','owner','id',{raw:'0x123',hash:'0x456',phase:'sent'});
  assert.equal(state.job('publish','owner','id')?.raw,'0x123');
  assert.equal(state.jobs()[0]?.payload.content,'private');
  state.updateJob('publish','owner','id',{phase:'done',result:{key:'public'}});
  assert.equal(state.jobs().length,0);
 }finally{state.close();}
});
test('an expired or superseded worker cannot save a transaction or overwrite completed work',()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));
 try{
  state.enqueue({kind:'publish',owner:'wallet',id:'id',payload:{}});
  state.lease('old',1000);assert.equal(state.renewLease('old',62000),false);
  assert.throws(()=>state.signedJob('old',62000,'publish','wallet','id','0x123','0x456'));
  state.lease('new',62000);state.updateJob('publish','wallet','id',{phase:'done'});
  assert.throws(()=>state.signedJob('old',62001,'publish','wallet','id','0x123','0x456'));
  assert.throws(()=>state.signedJob('new',62001,'publish','wallet','id','0x123','0x456'));
  assert.equal(state.job('publish','wallet','id').phase,'done');
 }finally{state.close();}
});
test('legacy crash recovery does not mark live relay uploads uncertain',()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32),false,false);
 try{
  for(const id of ['old','relay']){state.prepare('wallet',id,'hash',{title:id});state.begin('wallet',id,false);}
  state.enqueue({kind:'publish',owner:'wallet',id:'relay',payload:{}});
  state.recoverLegacyUploads();
  assert.equal(state.publication('wallet','old')?.status,'uncertain');
  assert.equal(state.publication('wallet','relay')?.status,'uploading');
 }finally{state.close();}
});
