import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockArkivStore } from './mock.ts';
import { createStorageService } from '../../../src/integrations/arkiv/service.ts';
import { address,recordBytes,canonical } from '../../../src/integrations/arkiv/codec.ts';
import { alice,bob,fixture,validator,request } from './fixtures.ts';
import { buildVersion,versionValues } from '../../../src/integrations/arkiv/records.ts';
import { parseDocument } from '../../../src/integrations/arkiv/codec.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const value=<T>(r:{state:'written';receipt:{value:T}}|{state:'recovered';value:T})=>r.state==='written'?r.receipt.value:r.value;
test('cross-client concurrent children produce multiple tips and block silent latest',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  const second=createStorageService(backend,validator);
  const base={rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:fixture};
  await Promise.all([store.publishVersion({...base,requestId:id(2)}),second.publishVersion({...base,requestId:id(3)})]);
  const history=await store.listVersions({rootVersionKey:root.versionKey});assert.equal(history.tipVersionKeys.length,2);
  await assert.rejects(store.publishVersion({...base,requestId:id(4)}),{code:'MULTIPLE_TIPS'});
});
test('history cap does not claim a latest version from a truncated scan',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  for(let n=2;n<=201;n++){const e=structuredClone(backend.entities.get(root.versionKey)!);e.key=`0x${n.toString(16).padStart(64,'0')}`;backend.entities.set(e.key,e);}
  const history=await store.listVersions({rootVersionKey:root.versionKey});assert.equal(history.complete,false);assert.deepEqual(history.tipVersionKeys,[]);
});
test('wrong mixed-case checksums are rejected rather than silently repaired',()=>{
  assert.throws(()=>address('0x52908400098527886E0F7030069857D2E4169Ee7'),{code:'INVALID_INPUT'});
});
test('optional empty keys and creator filters are invalid rather than omitted',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  await assert.rejects(store.listStrategies({creator:'' as never}),{code:'INVALID_INPUT'});
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture,communityKey:'' as never}),{code:'INVALID_INPUT'});
  assert.equal(backend.signed,0);
});
test('oversized record boundary is accepted exactly and overflow rejected',()=>{
  const atLimit={a:'x'.repeat(65528)};
  assert.equal(recordBytes(atLimit).length,65536);
  assert.throws(()=>recordBytes({a:'x'.repeat(65529)}),{code:'PAYLOAD_TOO_LARGE'});
});
test('sparse arrays and accessors cannot hide unvalidated input',()=>{
  assert.throws(()=>canonical(Array(2)),{code:'INVALID_INPUT'});
  let touched=false;const value={get secret(){touched=true;return 'hidden';}};
  assert.throws(()=>canonical(value),{code:'INVALID_INPUT'});assert.equal(touched,false);
});
test('history reads reuse verified ancestors only within one request',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));let parent=root.versionKey;
  for(let n=2;n<=6;n++)parent=value(await store.publishVersion({requestId:id(n),rootVersionKey:root.versionKey,expectedParentVersionKey:parent,document:fixture})).versionKey;
  let reads=0;const get=backend.get.bind(backend);backend.get=async key=>{reads++;return get(key);};
  assert.equal((await store.listVersions({rootVersionKey:root.versionKey})).versions.length,6);
  assert.ok(reads<=12,`History fetched ancestors ${reads} times`);
  backend.entities.delete(root.versionKey);
  assert.equal((await store.getVersion({versionKey:parent})).lineageStatus,'missing-ancestor');
});
test('extra optional indexed references absent from canonical content are rejected',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  const key=`0x${'a'.repeat(64)}` as const;
  backend.entities.get(root.versionKey)!.values.community=key;
  await assert.rejects(store.getVersion({versionKey:root.versionKey}),{code:'INTEGRITY_FAILED'});
  assert.equal((await store.listStrategies({communityKey:key})).items.length,0);
});
test('an unavailable parent does not conceal a contradictory available root',async()=>{
  const {store,backend}=createMockArkivStore({account:alice,validateStrategyDocument:validator});
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  backend.account=bob;
  const malicious=buildVersion(bob,id(2),parseDocument(fixture,validator),{strategyId:root.strategyId,rootVersionKey:root.versionKey,parentVersionKey:`0x${'f'.repeat(64)}`});
  const inserted=await(await backend.writer()).create('versions',versionValues(malicious),true);
  await assert.rejects(store.getVersion({versionKey:inserted.entityKey}),{code:'INTEGRITY_FAILED'});
});
test('a stale post-renewal read cannot report a verified extended expiration',async()=>{
  const {store,backend}=createMockArkivStore({account:alice});
  const community=value(await store.createCommunity({requestId:request,name:'Renew',description:''}));
  backend.block=BigInt(community.expiresAtBlock)-10n;
  const old=structuredClone(backend.entities.get(community.communityKey)!);const writer=backend.writer.bind(backend);
  backend.writer=async()=>{const w=await writer();return {...w,extend:async key=>{const included=await w.extend(key);backend.entities.set(key,old);return included;}};};
  await assert.rejects(store.extendOwnedEntity({entityKey:community.communityKey}),{code:'WRITE_CONFIRMED_READ_PENDING',included:true});
});
