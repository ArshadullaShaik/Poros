import test from 'node:test';
import assert from 'node:assert/strict';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
import {createMemberContentService} from '../../../src/features/builder/server/member-content.ts';
const creator=('0x'+'1'.repeat(40)) as `0x${string}`,signalKey=('0x'+'b'.repeat(64)) as `0x${string}`;
const content={title:'Private post',body:'Member rules',source:'manual' as const};
function setup(){
 const state=openMemberContentState(':memory:',new Uint8Array(32).fill(3));
 let uploads=0,stored='',allowed=true,broken=false,onRead=()=>{},overrideBody:string|undefined,reference='a'.repeat(128);const id=crypto.randomUUID();
 const signal:any={key:signalKey,type:'private-signal',source:'arkiv',actor:creator,subject:creator,scope:'global',requestId:id,data:null};
 const service=createMemberContentService({state,beeUrl:'http://localhost:1633',batchId:'a'.repeat(64),events:{read:async()=>signal},memberships:{canReadSignal:async()=>allowed,members:async()=>[{wallet:creator,expiresAt:100000,lastClaim:signalKey}]},now:()=>100,
 fetcher:async(url:any,init:any)=>{
  if(init.method==='POST'){uploads++;assert.equal(init.headers['swarm-encrypt'],'true');assert.equal(init.headers['swarm-deferred-upload'],'false');stored=init.body;if(broken)throw new Error('network failed');return Response.json({reference});}
  assert.match(String(url),/\/bytes\/[a-f0-9]{128}$/);onRead();return new Response(overrideBody??(broken?'bad json':stored));
 }});
 return {state,service,signal,id,get uploads(){return uploads;},set onRead(fn:()=>void){onRead=fn;},set readBody(value:string){overrideBody=value;},set reference(value:string){reference=value;},set allowed(value:boolean){allowed=value;},set broken(value:boolean){broken=value;}};
}
test('Swarm upload is encrypted, reused on retry, checked against signed entity, and never returns a secret reference',async()=>{
 const env=setup();try{
  const pointer=await env.service.upload({creator,publicationId:env.id,content});env.signal.data=pointer;
  assert.equal(pointer.swarmAddress.length,64);assert.ok(!JSON.stringify(pointer).includes('a'.repeat(128)));
  assert.deepEqual(await env.service.upload({creator,publicationId:env.id,content}),pointer);assert.equal(env.uploads,1);
  assert.deepEqual((await env.service.read({wallet:creator,signalKey})).content,content);
  await assert.rejects(env.service.upload({creator,publicationId:env.id,content:{...content,body:'Changed'}}),{code:'PUBLICATION_CONFLICT'});
  env.allowed=false;await assert.rejects(env.service.read({wallet:creator,signalKey}),{code:'MEMBERSHIP_EXPIRED'});
  env.allowed=true;env.signal.actor='0x'+'2'.repeat(40);await assert.rejects(env.service.read({wallet:creator,signalKey}));
  env.signal.actor=creator;env.broken=true;await assert.rejects(env.service.read({wallet:creator,signalKey}));
 }finally{env.state.close();}
});
test('uncertain uploads require explicit retry instead of automatically spending postage again',async()=>{
 const env=setup();try{
  env.broken=true;await assert.rejects(env.service.upload({creator,publicationId:env.id,content}));
  env.broken=false;await assert.rejects(env.service.upload({creator,publicationId:env.id,content}),{code:'UPLOAD_UNCERTAIN'});assert.equal(env.uploads,1);
  await env.service.upload({creator,publicationId:env.id,content,retryUncertain:true});assert.equal(env.uploads,2);
 }finally{env.state.close();}
});
test('access is rechecked after retrieval and corruption or oversized plaintext never escapes',async()=>{
 const env=setup();try{
  env.signal.data=await env.service.upload({creator,publicationId:env.id,content});
  env.signal.data={...env.signal.data,payloadHash:'0x'+'c'.repeat(64)};
  await assert.rejects(env.service.read({wallet:creator,signalKey}),{code:'CONTENT_UNAVAILABLE'});
 }finally{env.state.close();}
});


test('expiry while Bee is reading, oversized data, and malformed encrypted references fail closed',async()=>{
 const env=setup();try{
  env.signal.data=await env.service.upload({creator,publicationId:env.id,content});
  env.onRead=()=>{env.allowed=false;};
  await assert.rejects(env.service.read({wallet:creator,signalKey}),{code:'MEMBERSHIP_EXPIRED'});
  env.allowed=true;env.onRead=()=>{};env.readBody=JSON.stringify({...content,body:'a'.repeat(9000)});
  await assert.rejects(env.service.read({wallet:creator,signalKey}));
 }finally{env.state.close();}
 const malformed=setup();try{
  malformed.reference='a'.repeat(64);
  await assert.rejects(malformed.service.upload({creator,publicationId:malformed.id,content}),{code:'UPLOAD_UNCERTAIN'});
 }finally{malformed.state.close();}
});

test('a reference saved before failed read-back is reused without a second upload',async()=>{
 const env=setup();try{
  env.readBody='invalid json';await assert.rejects(env.service.upload({creator,publicationId:env.id,content}));
  assert.equal(env.state.publication(creator,env.id)?.status,'uploaded');
  env.readBody=JSON.stringify(content);await env.service.upload({creator,publicationId:env.id,content});
  assert.equal(env.uploads,1);
 }finally{env.state.close();}
});

test('relay reads use the signed creator and the canonical publication key, not a copied later entity',async()=>{
 const {privateKeyToAccount}=await import('viem/accounts');
 const {relayRequestId}=await import('../../../src/integrations/arkiv/community/membership-intent.ts');
 const {memberContentHash}=await import('../../../src/integrations/arkiv/community/member-content.ts');
 const signer=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`),owner=signer.address.toLowerCase() as `0x${string}`;
 const env=setup();
 try{
  const pointer=await env.service.upload({creator:owner,publicationId:env.id,content});
  const message=JSON.stringify({domain:'poros:member-content:1',operation:'publish',chainId:7794095,relayActor:creator,wallet:owner,origin:'https://poros.example',nonce:crypto.randomUUID(),issuedAt:1000,expiresAt:301000,target:{publicationId:env.id,payloadHash:memberContentHash(content),retryUncertain:false}});
  Object.assign(env.signal,{type:'private-signal-relay',subject:owner,requestId:relayRequestId('publish',owner,env.id),data:{...pointer,creator:owner,authorization:{message,signature:await signer.signMessage({message})}}});
  env.state.enqueue({kind:'publish',owner,id:env.id,payload:{}});env.state.updateJob('publish',owner,env.id,{phase:'done',result:{key:signalKey}});
  assert.deepEqual((await env.service.read({wallet:owner,signalKey})).content,content);
  env.state.updateJob('publish',owner,env.id,{result:{key:'0x'+'c'.repeat(64)}});
  await assert.rejects(env.service.read({wallet:owner,signalKey}),{code:'CONTENT_UNAVAILABLE'});
 }finally{env.state.close();}
});
test('relay upload readiness requires a ready Bee and a usable stamp without making an upload',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32));let usable=false,ready=true,uploads=0;
 const service=createMemberContentService({state,beeUrl:'http://127.0.0.1:1633',batchId:'a'.repeat(64),events:{} as any,memberships:{} as any,fetcher:async(url:any,init:any)=>{
  if(init.method==='POST')uploads++;
  return String(url).endsWith('/readiness')?Response.json({status:ready?'ready':'unready'},{status:ready?200:503}):Response.json({usable});
 }});
 try{
  await assert.rejects(service.assertUploadReady(),{code:'SWARM_UNAVAILABLE'});
  usable=true;await service.assertUploadReady();ready=false;
  await assert.rejects(service.assertUploadReady(),{code:'SWARM_UNAVAILABLE'});assert.equal(uploads,0);
 }finally{state.close();}
});
