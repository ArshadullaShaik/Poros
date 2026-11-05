import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityHub } from '../../../src/integrations/arkiv/community/service.ts';
import { buildEvent, decodeEvent } from '../../../src/integrations/arkiv/community/events.ts';
import type { EventInput, EventDTO, EventRepository, EventFilter } from '../../../src/integrations/arkiv/community/contracts.ts';
import { createMockArkivStore } from './mock.ts';
import { alice, bob, validator, fixture } from './fixtures.ts';
import {StorageError} from '../../../src/integrations/arkiv/errors.ts';

export class TestEvents implements EventRepository {
  source = 'mock' as const; account: `0x${string}` = alice; rows: EventDTO[] = []; block = 100n;
  async actor() { return this.account; }
  async read(key: `0x${string}`) { const row = this.rows.find(r => r.key === key); if (!row) throw new Error('Missing test event'); return structuredClone(row); }
  async scan(filter: EventFilter) { return this.rows.filter(r => (!filter.type || r.type === filter.type) && (!filter.subject || r.subject === filter.subject) &&
    (!filter.scope || r.scope === filter.scope) && (!filter.actor || r.actor === filter.actor) && (!filter.requestId || r.requestId === filter.requestId) &&
    (!filter.afterBlock || BigInt(r.createdAtBlock) >= BigInt(filter.afterBlock))).map(r => structuredClone(r)); }
  async append(input: EventInput) {
    assert.equal(input.actor, this.account);
    const old = this.rows.find(r => r.actor === input.actor && r.requestId === input.requestId);
    const record = buildEvent(input);
    if (old) { if (old.hash !== record.hash) throw Object.assign(new Error(), {code:'IDEMPOTENCY_CONFLICT'}); return old; }
    const row = { ...record, key: `0x${(++this.block).toString(16).padStart(64,'0')}` as const,
      createdAtBlock: String(this.block), expiresAtBlock: String(this.block + 1296000n), source: this.source };
    this.rows.push(row); return structuredClone(row);
  }
}
export async function communitySetup() {
  const { store } = createMockArkivStore({account:alice, validateStrategyDocument:validator});
  const created = await store.createCommunity({requestId:crypto.randomUUID(),name:'Bitcoin trading',description:'Public test community'});
  const communityKey = created.state === 'written' ? created.receipt.entityKey : created.entityKey;
  const events = new TestEvents(); const hub = createCommunityHub({ events, strategies:store });
  return {hub,events,communityKey,store};
}

test('strategy posts pin a validated public version and reject unavailable attachments',async()=>{
  const {hub,communityKey,store}=await communitySetup();
  const published=await store.publishStrategy({requestId:crypto.randomUUID(),document:fixture});
  const versionKey=published.state==='written'?published.receipt.entityKey:published.entityKey;
  const thread=await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'A shared strategy',body:'Review the exact version.',strategyVersionKey:versionKey});
  assert.equal(thread.data.strategyVersionKey,versionKey);
  assert.equal((await hub.listThreads({communityKey}))[0]!.data.strategyVersionKey,versionKey);
  await assert.rejects(hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'Unavailable version',body:'Must fail',strategyVersionKey:`0x${'f'.repeat(64)}`}));
});
test('wallet identity survives profile edits and colliding handles do not impersonate another wallet', async () => {
  const {hub,events} = await communitySetup();
  const profile = await hub.saveProfile({requestId:crypto.randomUUID(),handle:'satoshi',displayName:'Alice',bio:'Builder'});
  assert.equal(profile.userId, `eip155:7794095:${alice}`);
  events.account = bob;
  await hub.saveProfile({requestId:crypto.randomUUID(),handle:'satoshi',displayName:'Bob',bio:''});
  assert.equal((await hub.searchProfiles({handle:'satoshi'})).length,2);
  assert.equal((await hub.getProfile({wallet:alice}))?.displayName,'Alice');
  await assert.rejects(hub.saveProfile({requestId:crypto.randomUUID(),handle:'satoshi',displayName:'Impersonator',bio:'',previousKey:profile.key}));
});
test('community membership, threaded discussion, chat and owner moderation cross user boundaries', async () => {
  const {hub,events,communityKey} = await communitySetup();
  events.account = bob;
  await assert.rejects(hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'not joined'}));
  await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  const thread = await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'BTC discussion',body:'A public thread'});
  const message = await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Hello traders'});
  await hub.reply({requestId:crypto.randomUUID(),communityKey,threadKey:thread.key,body:'A reply'});
  assert.equal((await hub.listReplies({communityKey,threadKey:thread.key})).length,1);
  assert.equal((await hub.listMessages({communityKey,afterBlock:message.createdAtBlock})).length,1);
  await assert.rejects(hub.setBan({requestId:crypto.randomUUID(),communityKey,wallet:alice,banned:true}));
  events.account = alice;
  await hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:message.key,hidden:true});
  assert.equal((await hub.listMessages({communityKey})).length,0);
  await hub.setBan({requestId:crypto.randomUUID(),communityKey,wallet:bob,banned:true});
  events.account = bob;
  await assert.rejects(hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'blocked'}));
  events.account = alice;
  await hub.setBan({requestId:crypto.randomUUID(),communityKey,wallet:bob,banned:false});
  await hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:message.key,hidden:false});
  assert.equal((await hub.listMessages({communityKey})).length,1);
});
test('wallet votes switch, clear, recover, and reject nonmembers or non-discussion targets', async () => {
  const {hub,events,communityKey}=await communitySetup();
  const thread=await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'Question',body:'Discuss'});
  const message=await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Chat'});
  events.account=bob;
  await assert.rejects(hub.setVote({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,value:1}),{code:'NOT_OWNER'});
  await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  const input={requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,value:1 as const};
  const first=await hub.setVote(input);
  assert.equal((await hub.setVote(input)).key,first.key);
  assert.equal((await hub.getVoteSummaries({communityKey,contentKeys:[thread.key],viewer:bob}))[thread.key]?.score,1);
  await hub.setVote({...input,requestId:crypto.randomUUID(),value:-1});
  assert.deepEqual((await hub.getVoteSummaries({communityKey,contentKeys:[thread.key],viewer:bob}))[thread.key],{score:-1,up:0,down:1,viewerVote:-1});
  await hub.setVote({...input,requestId:crypto.randomUUID(),value:0});
  assert.equal((await hub.getVoteSummaries({communityKey,contentKeys:[thread.key]}))[thread.key]?.score,0);
  events.account=alice;
  const before=await hub.getVoteSummaries({communityKey,contentKeys:[thread.key]});
  events.account=`0x${'c'.repeat(40)}`;
  await events.append({type:'vote',actor:events.account,subject:thread.key,scope:communityKey,requestId:crypto.randomUUID(),data:{contentKey:thread.key,value:1}});
  assert.deepEqual(await hub.getVoteSummaries({communityKey,contentKeys:[thread.key]}),before);
  events.account=bob;
  await assert.rejects(hub.setVote({...input,requestId:crypto.randomUUID(),contentKey:message.key}),{code:'INVALID_INPUT'});
});
test('owner delegates hide only, revokes it, and forged moderation cannot hide content', async () => {
  const {hub,events,communityKey}=await communitySetup();
  const thread=await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'Question',body:'Discuss'});
  events.account=bob;
  await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  await assert.rejects(hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,hidden:true}),{code:'NOT_OWNER'});
  events.account=alice;
  await hub.setModerator({requestId:crypto.randomUUID(),communityKey,wallet:bob,enabled:true});
  assert.equal(await hub.isModerator({communityKey,wallet:bob}),true);
  events.account=bob;
  await hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,hidden:true});
  assert.equal((await hub.listThreads({communityKey})).length,0);
  await assert.rejects(hub.setBan({requestId:crypto.randomUUID(),communityKey,wallet:alice,banned:true}),{code:'NOT_OWNER'});
  events.account=alice;
  await hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,hidden:false});
  assert.equal((await hub.listThreads({communityKey})).length,1);
  await hub.setModerator({requestId:crypto.randomUUID(),communityKey,wallet:bob,enabled:false});
  events.account=bob;
  assert.equal(await hub.isModerator({communityKey,wallet:bob}),false);
  await assert.rejects(hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,hidden:true}),{code:'NOT_OWNER'});
  await events.append({type:'hidden',actor:bob,subject:thread.key,scope:communityKey,requestId:crypto.randomUUID(),data:{contentKey:thread.key,hidden:true}});
  assert.equal((await hub.listThreads({communityKey})).length,1);
});
test('a vote predating its referenced content cannot raise its score',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  const thread=await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'Later',body:'Body'});
  const vote=await events.append({type:'vote',actor:alice,subject:thread.key,scope:communityKey,requestId:crypto.randomUUID(),data:{contentKey:thread.key,value:1}});
  events.rows.find(row=>row.key===vote.key)!.createdAtBlock='1';
  assert.equal((await hub.getVoteSummaries({communityKey,contentKeys:[thread.key]}))[thread.key]?.score,0);
});
test('vote summaries cover the full bounded room feed beyond 100 threads',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  const keys:EventDTO['key'][]=[];
  for(let i=0;i<101;i++)keys.push((await events.append({type:'thread',actor:alice,subject:communityKey,scope:communityKey,requestId:crypto.randomUUID(),data:{title:`Topic ${i}`,body:'Body'}})).key);
  const summaries=await hub.getVoteSummaries({communityKey,contentKeys:keys});
  assert.equal(Object.keys(summaries).length,101);
  assert.equal(summaries[keys[100]!]!.score,0);
});
test('conflicting former moderator hides cannot block owner restoration',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  const thread=await hub.createThread({requestId:crypto.randomUUID(),communityKey,title:'Topic',body:'Body'});
  events.account=bob;await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  events.account=alice;await hub.setModerator({requestId:crypto.randomUUID(),communityKey,wallet:bob,enabled:true});
  events.account=bob;
  for(let i=0;i<2;i++)await events.append({type:'hidden',actor:bob,subject:thread.key,scope:communityKey,requestId:crypto.randomUUID(),data:{contentKey:thread.key,hidden:true}});
  events.account=alice;
  await hub.setModerator({requestId:crypto.randomUUID(),communityKey,wallet:bob,enabled:false});
  await hub.setHidden({requestId:crypto.randomUUID(),communityKey,contentKey:thread.key,hidden:false});
  assert.deepEqual((await hub.listThreads({communityKey})).map(row=>row.key),[thread.key]);
});
test('competing profile tips and mismatched event provenance fail closed', async () => {
  const {hub,events} = await communitySetup();
  const args = {requestId:crypto.randomUUID(),handle:'alice',displayName:'Alice',bio:''};
  const p = await hub.saveProfile(args);
  assert.equal((await hub.saveProfile(args)).key,p.key);
  events.rows.push({...events.rows[0]!, key:`0x${'ab'.repeat(32)}`,requestId:crypto.randomUUID()});
  await assert.rejects(hub.getProfile({wallet:alice}),{code:'CONCURRENT_UPDATE'});
  const record = buildEvent({actor:alice,type:'profile',subject:alice,scope:'global',requestId:crypto.randomUUID(),data:{handle:'alice',displayName:'Alice',bio:''}});
  assert.throws(() => decodeEvent({...record,hash:`0x${'00'.repeat(32)}`},alice,alice,true,false));
  assert.throws(() => decodeEvent(record,alice,bob,true,false));
  assert.throws(() => decodeEvent(record,alice,alice,false,false));
});
test('readers reject raw permissionless nonmember messages and ignore forged owner moderation',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  events.account=bob;
  await events.append({actor:bob,type:'message',subject:communityKey,scope:communityKey,requestId:crypto.randomUUID(),data:{body:'Bypassed the hub'}});
  assert.equal((await hub.listMessages({communityKey})).length,0);
  await events.append({actor:bob,type:'ban',subject:alice,scope:communityKey,requestId:crypto.randomUUID(),data:{wallet:alice,banned:true}});
  events.account=alice;
  await hub.sendMessage({communityKey,requestId:crypto.randomUUID(),body:'Owner remains authorized'});
  assert.equal((await hub.listMessages({communityKey})).length,1);
  events.account=bob;
  const join=await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  const beforeLeave=await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Valid while joined'});
  await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'left',previousKey:join.key});
  await events.append({actor:bob,type:'message',subject:communityKey,scope:communityKey,requestId:crypto.randomUUID(),data:{body:'Stale membership proof',membershipKey:join.key}});
  const rows=await hub.listMessages({communityKey});
  assert.equal(rows.length,2);assert.ok(rows.some(row=>row.key===beforeLeave.key));
});
test('owner ban and hide first-write retries recover their original event instead of parenting themselves',async()=>{
  const {hub,communityKey}=await communitySetup();
  const ban={requestId:crypto.randomUUID(),communityKey,wallet:bob,banned:true};
  const first=await hub.setBan(ban);assert.equal((await hub.setBan(ban)).key,first.key);
  const message=await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Owner message'});
  const hide={requestId:crypto.randomUUID(),communityKey,contentKey:message.key,hidden:true};
  const hidden=await hub.setHidden(hide);assert.equal((await hub.setHidden(hide)).key,hidden.key);
});
test('an outsider conflicting their own membership or profile cannot suppress other users in public views',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  await hub.saveProfile({requestId:crypto.randomUUID(),handle:'trader',displayName:'Alice',bio:''});
  const ownerMessage=await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Visible owner message'});
  events.account=bob;
  for(let i=0;i<2;i++)await events.append({type:'profile',actor:bob,subject:bob,scope:'global',requestId:crypto.randomUUID(),data:{handle:'trader',displayName:'Conflicted',bio:''}});
  const join=await events.append({type:'membership',actor:bob,subject:bob,scope:communityKey,requestId:crypto.randomUUID(),data:{state:'joined'}});
  await events.append({type:'membership',actor:bob,subject:bob,scope:communityKey,requestId:crypto.randomUUID(),data:{state:'joined'}});
  await events.append({type:'message',actor:bob,subject:communityKey,scope:communityKey,requestId:crypto.randomUUID(),data:{body:'Conflicted author',membershipKey:join.key}});
  assert.deepEqual((await hub.listMessages({communityKey})).map(row=>row.key),[ownerMessage.key]);
  assert.equal((await hub.searchProfiles({handle:'trader'})).length,1);
  await assert.rejects(hub.getProfile({wallet:bob}),{code:'CONCURRENT_UPDATE'});
  await assert.rejects(hub.getMembership({communityKey,wallet:bob}),{code:'CONCURRENT_UPDATE'});
});
test('oversized or unsupported author state is isolated while trusted owner/network failures stay visible',async()=>{
  const {hub,events,communityKey}=await communitySetup();
  await hub.saveProfile({requestId:crypto.randomUUID(),handle:'trader',displayName:'Alice',bio:''});
  await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Owner message'});
  events.account=bob;await hub.saveProfile({requestId:crypto.randomUUID(),handle:'trader',displayName:'Bob',bio:''});
  const join=await hub.setMembership({requestId:crypto.randomUUID(),communityKey,state:'joined'});
  await hub.sendMessage({requestId:crypto.randomUUID(),communityKey,body:'Bob message'});
  const scan=events.scan.bind(events);
  for(const code of ['PAYLOAD_TOO_LARGE','UNSUPPORTED_SCHEMA']as const){
    events.scan=async filter=>{if(filter.actor===bob)throw new StorageError(code);return scan(filter);};
    assert.equal((await hub.listMessages({communityKey})).length,1);
    assert.equal((await hub.searchProfiles({handle:'trader'})).length,1);
    await assert.rejects(hub.getProfile({wallet:bob}),{code});
  }
  events.scan=async filter=>{if(filter.actor===alice&&filter.type==='ban')throw new StorageError('NETWORK_UNAVAILABLE');return scan(filter);};
  await assert.rejects(hub.listMessages({communityKey}),{code:'NETWORK_UNAVAILABLE'});
  assert.ok(join.key);
});
