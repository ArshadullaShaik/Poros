import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockArkivStore } from './mock.ts';
import { alice,bob,validator,request } from './fixtures.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const value=<T>(r:{state:'written';receipt:{value:T}}|{state:'recovered';value:T})=>r.state==='written'?r.receipt.value:r.value;
test('community owner edits metadata while posts remain owned by their authors',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const c=value(await store.createCommunity({requestId:request,name:'Public group',description:'Rules'}));
  const edit=await store.updateCommunity({communityKey:c.communityKey,name:'Renamed',description:'New rules'});
  assert.equal(edit.value.name,'Renamed');assert.notEqual(edit.value.contentHash,c.contentHash);
  backend.account=bob;
  await assert.rejects(store.updateCommunity({communityKey:c.communityKey,name:'Hijack',description:''}),{code:'NOT_OWNER'});
  const post=value(await store.createPost({requestId:id(2),communityKey:c.communityKey,body:'Hello'}));assert.equal(post.creator,bob);
  backend.account=alice;
  await assert.rejects(store.deleteOwnedEntity({entityKey:post.postKey}),{code:'NOT_OWNER'});
  await store.deleteOwnedEntity({entityKey:c.communityKey});
  assert.equal((await store.listPosts({communityKey:c.communityKey})).items[0]?.body,'Hello');
});
test('create recovery spans entity types and never silently changes intent',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  const args={requestId:request,name:'Group',description:'Public'};
  await store.createCommunity(args);assert.equal((await store.createCommunity(args)).state,'recovered');assert.equal(backend.signed,1);
  await assert.rejects(store.createCommunity({...args,name:'Other'}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('renewal is a no-op early and extends from current block near expiry',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});const c=value(await store.createCommunity({requestId:request,name:'Group',description:''}));
  assert.equal((await store.extendOwnedEntity({entityKey:c.communityKey})).state,'unchanged');assert.equal(backend.signed,1);
  backend.block=BigInt(c.expiresAtBlock)-100n;
  const result=await store.extendOwnedEntity({entityKey:c.communityKey});assert.equal(result.state,'extended');
  if(result.state==='extended')assert.equal(BigInt(result.receipt.expiresAtBlock),backend.block+1_296_000n);
  backend.block+=1_296_001n;
  await assert.rejects(store.getCommunity({communityKey:c.communityKey}),{code:'NOT_FOUND_OR_EXPIRED'});
});
test('community expiration duration is configurable and any person can permissionlessly extend near expiry',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  const c=value(await store.createCommunity({requestId:request,name:'Expiring group',description:'',durationDays:30}));
  assert.equal(BigInt(c.expiresAtBlock),backend.block + 216_000n);
  backend.account=bob;
  backend.block=BigInt(c.expiresAtBlock)-100n;
  const extension=await store.extendOwnedEntity({entityKey:c.communityKey,durationDays:90});
  assert.equal(extension.state,'extended');
  if(extension.state==='extended')assert.equal(BigInt(extension.receipt.expiresAtBlock),backend.block + 648_000n);
});
test('pagination advances past a malformed page instead of ending the feed',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  const c=value(await store.createCommunity({requestId:request,name:'First',description:''}));
  await store.createCommunity({requestId:id(2),name:'Second',description:''});
  backend.entities.get(c.communityKey)!.values.record=new TextEncoder().encode('{"bad":true}');
  const first=await store.listCommunities({page:{limit:1}});assert.equal(first.items.length,0);assert.equal(first.nextOffset,1);assert.equal(first.skipped,1);
  const second=await store.listCommunities({page:{offset:1,limit:1}});assert.equal(second.items[0]?.name,'Second');
});
test('invalid pagination, unknown filters, oversized posts and foreign keys never sign',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  await assert.rejects(store.listCommunities({page:{limit:101}}),{code:'INVALID_INPUT'});
  await assert.rejects(store.listStrategies({surprise:true} as never),{code:'INVALID_INPUT'});
  await assert.rejects(store.createPost({requestId:request,communityKey:`0x${'a'.repeat(64)}`,body:'a'.repeat(2001)}),{code:'INVALID_INPUT'});
  assert.equal(backend.signed,0);
});
test('extra optional post index cannot claim an unrecorded strategy relationship',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  const c=value(await store.createCommunity({requestId:request,name:'Group',description:''}));
  const p=value(await store.createPost({requestId:id(2),communityKey:c.communityKey,body:'Hi'}));
  backend.entities.get(p.postKey)!.values.strategyVersion=`0x${'f'.repeat(64)}`;
  const result=await store.listPosts({communityKey:c.communityKey});assert.equal(result.items.length,0);assert.equal(result.skipped,1);
});
