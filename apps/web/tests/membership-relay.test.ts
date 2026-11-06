import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
import {createRelayWorker} from '../../../src/features/builder/server/membership-relay.ts';
const owner=('0x'+'1'.repeat(40)) as `0x${string}`,key=('0x'+'2'.repeat(64)) as `0x${string}`;
function setup(){
 const state=openMemberContentState(':memory:',new Uint8Array(32));let sends=0,broadcasts=0,scans:any[]=[],fail=true,uploadCalls=0;
 const writer=(privateKey:any,accessKey:any,signed:any)=>({address:owner,events:{scan:async()=>scans,append:async(event:any)=>{sends++;signed('0x123',key);assert.equal(state.jobs()[0]?.raw,'0x123');if(fail)throw Error('Disconnected after signing');return {...event,key};}},client:{getChainId:async()=>7794095,getBalance:async()=>1n,getTransactionReceipt:async()=>{throw Object.assign(Error('pending'),{name:'TransactionReceiptNotFoundError'});},sendRawTransaction:async({serializedTransaction}:any)=>{assert.equal(serializedTransaction,'0x123');broadcasts++;}}});
 const runtime:any={state,service:{assertUploadReady:async()=>{},upload:async()=>{uploadCalls++;return {format:'swarm-message/1'};}}};
 const tick=createRelayWorker(runtime,key,writer as any);
 return {state,tick,get sends(){return sends;},get broadcasts(){return broadcasts;},get uploads(){return uploadCalls;},set scans(value:any[]){scans=value;},set fail(value:boolean){fail=value;}};
}
test('unknown inclusion rebroadcasts the same saved transaction and blocks other jobs from taking its nonce',async()=>{
 const env=setup();
 try{
  const id=crypto.randomUUID();env.state.enqueue({kind:'publish',owner,id,payload:{content:{title:'Private'},authorization:{message:JSON.stringify({relayActor:owner})}}});
  env.state.enqueue({kind:'publish',owner,id:crypto.randomUUID(),payload:{content:{title:'Next'},authorization:{message:JSON.stringify({relayActor:owner})}}});
  await env.tick();assert.equal(env.sends,1);assert.equal(env.uploads,1);
  await env.tick();assert.equal(env.sends,1);assert.equal(env.broadcasts,1);assert.equal(env.uploads,1);
  env.scans=[{key,type:'private-signal-relay'}];await env.tick();assert.equal(env.state.jobs().length,0);
 }finally{env.state.close();}
});
test('a retry permission is consumed once even when another encrypted upload times out',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));let retries:any[]=[];
 const runtime:any={state,service:{assertUploadReady:async()=>{},upload:async(input:any)=>{retries.push(input.retryUncertain);throw Object.assign(Error('uncertain'),{code:'UPLOAD_UNCERTAIN'});}}};
 const writer:any=()=>({address:owner,events:{scan:async()=>[]},client:{getChainId:async()=>7794095,getBalance:async()=>1n}});
 try{
  state.enqueue({kind:'publish',owner,id:crypto.randomUUID(),payload:{content:{},authorization:{message:JSON.stringify({relayActor:owner})},retryUncertain:true}});
  const tick=createRelayWorker(runtime,key,writer);await tick();await tick();assert.deepEqual(retries,[true]);
 }finally{state.close();}
});
test('waiting-for-user uploads cannot starve later jobs, and unfunded workers reconcile included writes',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));let sent=0,funded=true;
 const runtime:any={state,service:{assertUploadReady:async()=>{},upload:async()=>({format:'swarm-message/1'})}};
 const writer:any=()=>({address:owner,events:{scan:async()=>funded?[]:[{key}],append:async()=>{sent++;return {key};}},client:{getChainId:async()=>7794095,getBalance:async()=>funded?1n:0n}});
 try{
  for(let i=0;i<11;i++){const id=crypto.randomUUID();state.enqueue({kind:'publish',owner,id,payload:{retryUncertain:false}});state.updateJob('publish',owner,id,{error:'UPLOAD_UNCERTAIN'});}
  const id=crypto.randomUUID();state.enqueue({kind:'publish',owner,id,payload:{content:{},authorization:{message:JSON.stringify({relayActor:owner})}}});
  const tick=createRelayWorker(runtime,key,writer);await tick();assert.equal(sent,1);
  const pending=crypto.randomUUID();state.enqueue({kind:'publish',owner,id:pending,payload:{}});state.updateJob('publish',owner,pending,{raw:'0x123',hash:key,phase:'sent'});
  funded=false;await tick();assert.equal(state.job('publish',owner,pending).phase,'done');
 }finally{state.close();}
});
test('Bee startup or unusable stamps leave a publication queued without attempting a paid upload',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));let ready=false,uploads=0;
 const runtime:any={state,service:{assertUploadReady:async()=>{if(!ready)throw Error('Bee is still syncing');},upload:async()=>{uploads++;return {format:'swarm-message/1'};}}};
 const writer:any=()=>({address:owner,events:{scan:async()=>[],append:async()=>({key})},client:{getChainId:async()=>7794095,getBalance:async()=>1n}});
 try{
  const id=crypto.randomUUID();state.enqueue({kind:'publish',owner,id,payload:{content:{},authorization:{message:JSON.stringify({relayActor:owner})}}});
  const tick=createRelayWorker(runtime,key,writer);await tick();assert.equal(uploads,0);assert.equal(state.job('publish',owner,id).phase,'queued');
  ready=true;await tick();assert.equal(uploads,1);assert.equal(state.job('publish',owner,id).phase,'done');
 }finally{state.close();}
});
