import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockArkivStore } from './mock.ts';
import { alice, bob, fixture, validator, request } from './fixtures.ts';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const value=<T>(r:{state:'written';receipt:{value:T}}|{state:'recovered';value:T})=>r.state==='written'?r.receipt.value:r.value;
const setup=()=>createMockArkivStore({account:alice,validateStrategyDocument:validator});
test('public browse never needs a writer; publish/read/revision round-trip exact content',async()=>{
  const {store,backend}=setup(); backend.account=undefined;
  assert.deepEqual((await store.listStrategies()).items,[]); assert.equal(backend.checks,0);
  backend.account=alice;
  const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  assert.equal(root.creator,alice); assert.equal(root.owner,alice); assert.equal(root.source,'mock');
  const second=value(await store.publishVersion({requestId:id(2),rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:{...fixture,name:'Changed'}}));
  assert.equal(second.parentVersionKey,root.versionKey); assert.equal(second.strategyId,root.strategyId);
  assert.equal((await store.getVersion({versionKey:root.versionKey})).document.name,'Hold');
  const history=await store.listVersions({rootVersionKey:root.versionKey});
  assert.equal(history.complete,true); assert.deepEqual(history.tipVersionKeys,[second.versionKey]);
});
test('fork pins selected old version and belongs to Bob without changing Alice',async()=>{
  const {store,backend}=setup(); const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  await store.publishVersion({requestId:id(2),rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:{...fixture,name:'New'}});
  backend.account=bob; const fork=value(await store.forkVersion({requestId:id(3),sourceVersionKey:root.versionKey,document:fixture}));
  assert.equal(fork.owner,bob); assert.equal(fork.forkSourceVersionKey,root.versionKey);
  assert.equal(fork.forkSourceContentHash,root.contentHash); assert.notEqual(fork.strategyId,root.strategyId);
  await assert.rejects(store.publishVersion({requestId:id(4),rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:fixture}),{code:'NOT_OWNER'});
});
test('retry recovers before stale-parent checks and conflicting intent never signs',async()=>{
  const {store,backend}=setup(); const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  const input={requestId:id(2),rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:{...fixture,name:'V2'}};
  await store.publishVersion(input); const signed=backend.signed;
  assert.equal((await store.publishVersion(input)).state,'recovered'); assert.equal(backend.signed,signed);
  await assert.rejects(store.publishStrategy({requestId:request,document:{...fixture,name:'Different'}}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(backend.signed,signed);
});
test('timeout after included create recovers one entity without re-signing',async()=>{
  const {store,backend}=setup(); backend.timeoutAfterCreate=true;
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture}),{code:'WRITE_STATUS_UNKNOWN'});
  assert.equal((await store.publishStrategy({requestId:request,document:fixture})).state,'recovered'); assert.equal(backend.signed,1);
});
test('included write with failed read-back remains pending and is never silently retried',async()=>{
  const {store,backend}=setup(); backend.failReadAfterCreate=true;
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture}),{code:'WRITE_CONFIRMED_READ_PENDING',included:true});
  assert.equal(backend.signed,1);
});
test('metadata tampering and namespace impersonation fail integrity/provenance checks',async()=>{
  const {store,backend}=setup();const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  backend.entities.get(root.versionKey)!.values.name='Forged';
  await assert.rejects(store.getVersion({versionKey:root.versionKey}),{code:'INTEGRITY_FAILED'});
  const feed=await store.listStrategies();assert.equal(feed.items.length,0);assert.equal(feed.skipped,1);
  backend.entities.get(root.versionKey)!.values.name='Hold';backend.entities.get(root.versionKey)!.creator=bob;
  await assert.rejects(store.getVersion({versionKey:root.versionKey}),{code:'UNTRUSTED_RECORD'});
});
test('deleted ancestors degrade history and block new revisions',async()=>{
  const {store,backend}=setup();const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  const child=value(await store.publishVersion({requestId:id(2),rootVersionKey:root.versionKey,expectedParentVersionKey:root.versionKey,document:fixture}));
  backend.entities.delete(root.versionKey);
  assert.equal((await store.getVersion({versionKey:child.versionKey})).lineageStatus,'missing-ancestor');
  await assert.rejects(store.publishVersion({requestId:id(3),rootVersionKey:root.versionKey,expectedParentVersionKey:child.versionKey,document:fixture}),{code:'NOT_FOUND_OR_EXPIRED'});
});
test('account changes and invalid graphs fail before signing',async()=>{
  const {store,backend}=setup();backend.changedAccount=true;
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture}),{code:'ACCOUNT_CHANGED'});assert.equal(backend.signed,0);
  backend.changedAccount=false;
  await assert.rejects(store.publishStrategy({requestId:request,document:{...fixture,graph:{wrong:true}}}),{code:'INVALID_INPUT'});assert.equal(backend.signed,0);
});
test('duplicate requests are reported rather than picking the first record',async()=>{
  const {store,backend}=setup();const root=value(await store.publishStrategy({requestId:request,document:fixture}));
  const duplicate=structuredClone(backend.entities.get(root.versionKey)!);duplicate.key=`0x${'f'.repeat(64)}`;backend.entities.set(duplicate.key,duplicate);
  assert.equal((await store.reconcileRequest({creator:alice,requestId:request})).state,'duplicates');
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture}),{code:'DUPLICATE_REQUEST'});
});
