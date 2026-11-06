import test from 'node:test';
import assert from 'node:assert/strict';
type Hex = `0x${string}`;
import { alice, bob } from './fixtures.ts';
import { buildEvent } from '../../../src/integrations/arkiv/community/events.ts';
import type { EventDTO, EventRepository } from '../../../src/integrations/arkiv/community/contracts.ts';
import { createCreatorMemberships, MEMBERSHIP_MS } from '../../../src/integrations/arkiv/community/memberships.ts';
import { verifyMembershipPayment, type PaymentClient } from '../../../src/integrations/arkiv/community/sepolia.ts';

const hash = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;
function chain() {
  const state = { chainId: 11155111, head: 11n, status: 'success', from: bob, to: alice, value: 100n, blockHash: hash(3), timestamp: 10250n, input: '0x' };
  const client = {
    getChainId: async () => state.chainId,
    getBlockNumber: async () => state.head,
    getTransaction: async ({ hash: transactionHash }: { hash: Hex }) => ({ hash: transactionHash, from: state.from, to: state.to, value: state.value, input: state.input, blockNumber: 10n, blockHash: hash(3) }),
    getTransactionReceipt: async ({ hash: transactionHash }: { hash: Hex }) => ({ transactionHash, status: state.status, blockNumber: 10n, blockHash: hash(3) }),
    getBlock: async () => ({ hash: state.blockHash, timestamp: state.timestamp }),
  } as unknown as PaymentClient;
  return { state, client };
}
function setup() {
  let account = alice;
  const rows: EventDTO[] = [];
  const events: EventRepository = {
    source: 'arkiv', actor: async () => account,
    read: async key => { const row = rows.find(row => row.key === key); assert.ok(row); return structuredClone(row); },
    scan: async filter => rows.filter(row => Object.entries(filter).every(([key, value]) => row[key as keyof EventDTO] === value)).map(row => structuredClone(row)),
    append: async input => {
      assert.equal(input.actor, account);
      const built = buildEvent(input);
      const prior = rows.find(row => row.actor === account && row.requestId === input.requestId);
      if (prior) { assert.equal(prior.hash, built.hash); return prior; }
      const block = 101 + rows.length;
      const row = { ...built, source: 'arkiv' as const, key: hash(block), createdAtBlock: String(block), expiresAtBlock: String(block + 7776000) };
      rows.push(row); return row;
    },
  };
  const { client, state } = chain();
  const service = createCreatorMemberships(events, { payments: client, blockTimestamp: async block => Number(block) * 100000 });
  return { rows, events, service, state, client, account: (next: Hex) => { account = next; } };
}

test('subscriptions restore from verified Arkiv claims for the connected wallet',async()=>{
  const env=setup();
  const plan=await env.service.publishPlan({priceWei:'100',requestId:crypto.randomUUID()});
  assert.equal((await env.service.plans())[0]?.key,plan.key);
  env.account(bob);
  const key=await env.service.registerKey({identity:{publicKey:'a'.repeat(43),backup:{iv:'a'.repeat(16),ciphertext:'b'.repeat(80)}},requestId:crypto.randomUUID()});
  const claim=await env.service.claim({planKey:plan.key,keyRecord:key.key,transactionHash:hash(9),requestId:crypto.randomUUID()});
  const reloaded=createCreatorMemberships(env.events,{payments:env.client,blockTimestamp:async block=>Number(block)*100000});
  assert.deepEqual(await reloaded.subscriptions(bob),[{creator:alice,expiresAt:10300000+MEMBERSHIP_MS,lastClaim:claim.key}]);
  assert.deepEqual(await reloaded.subscriptions(alice),[]);
  env.state.value=1n;
  assert.deepEqual(await reloaded.subscriptions(bob),[]);
});

test('native Sepolia membership verification rejects wrong chain, parties, amount, failure, unconfirmed blocks, data and reorgs', async () => {
  const expected = { transactionHash: hash(9), buyer: bob, creator: alice, priceWei: '100' };
  const mutations = [{ chainId: 1 }, { from: alice }, { to: bob }, { value: 99n }, { status: 'reverted' }, { head: 10n }, { input: '0x1234' }, { blockHash: hash(4) }];
  assert.equal(await verifyMembershipPayment(chain().client, expected), 10250000);
  for (const mutation of mutations) {
    const { state, client } = chain(); Object.assign(state, mutation);
    await assert.rejects(verifyMembershipPayment(client, expected));
  }
});

test('payment claims activate from the Arkiv claim and renew once per transaction', async () => {
  const env = setup();
  const plan = await env.service.publishPlan({ priceWei: '100', requestId: crypto.randomUUID() });
  env.account(bob);
  const key = await env.service.registerKey({ identity: { publicKey: 'a'.repeat(43), backup: { iv: 'a'.repeat(16), ciphertext: 'b'.repeat(80) } }, requestId: crypto.randomUUID() });
  const input = { planKey: plan.key, transactionHash: hash(9), keyRecord: key.key, requestId: crypto.randomUUID() };
  const claim = await env.service.claim(input);
  assert.equal((await env.service.members(alice))[0]!.expiresAt, 10300000 + MEMBERSHIP_MS);
  assert.equal((await env.service.claim({ ...input, requestId: crypto.randomUUID() })).key, claim.key);
  assert.equal((await env.service.members(alice))[0]!.expiresAt, 10300000 + MEMBERSHIP_MS);
  await env.service.claim({ ...input, transactionHash: hash(10), requestId: crypto.randomUUID() });
  assert.equal((await env.service.members(alice))[0]!.expiresAt, 10300000 + 2 * MEMBERSHIP_MS);
  assert.equal(env.rows.filter(row => row.type === 'membership').length, 0);
});

test('raw duplicate payment claims and claims for another wallet do not add access', async () => {
  const env = setup();
  const plan = await env.service.publishPlan({ priceWei: '100', requestId: crypto.randomUUID() });
  env.account(bob);
  const key = await env.service.registerKey({ identity: { publicKey: 'a'.repeat(43), backup: { iv: 'a'.repeat(16), ciphertext: 'b'.repeat(80) } }, requestId: crypto.randomUUID() });
  const claim = await env.service.claim({ planKey: plan.key, transactionHash: hash(9), keyRecord: key.key, requestId: crypto.randomUUID() });
  env.rows.push({ ...claim, key: hash(200), createdAtBlock: '200' });
  assert.equal((await env.service.members(alice))[0]!.expiresAt, 10300000 + MEMBERSHIP_MS);
  env.state.from = alice;
  assert.deepEqual(await env.service.members(alice), []);
});

test('private delivery includes only members active before publication and recovers one recipient envelope',async()=>{
  const env=setup();
  const identity={publicKey:'a'.repeat(43),backup:{iv:'a'.repeat(16),ciphertext:'b'.repeat(80)}};
  const creatorKey=await env.service.registerKey({identity,requestId:crypto.randomUUID()});
  const plan=await env.service.publishPlan({priceWei:'100',requestId:crypto.randomUUID()});
  env.account(bob);
  const buyerKey=await env.service.registerKey({identity,requestId:crypto.randomUUID()});
  env.account(alice);
  const box={publicKey:'a'.repeat(43),salt:'a'.repeat(43),iv:'a'.repeat(16),ciphertext:'b'.repeat(64)};
  const encrypted={iv:'a'.repeat(16),ciphertext:'b'.repeat(80),creatorKey:creatorKey.key,creatorBox:box,source:'manual' as const};
  const oldId=crypto.randomUUID();
  const pointer=(id:string)=>({format:"swarm-message/1" as const,publicationId:id,swarmAddress:"a".repeat(64),payloadHash:hash(1),source:"manual" as const});
  const oldSignal=await env.service.publishSignal({pointer:pointer(oldId),requestId:oldId});
  env.account(bob);
  const claim=await env.service.claim({planKey:plan.key,keyRecord:buyerKey.key,transactionHash:hash(8),requestId:crypto.randomUUID()});
  env.account(alice);
  const id=crypto.randomUUID();
  const signal=await env.service.publishSignal({pointer:pointer(id),requestId:id});
  assert.deepEqual(await env.service.recipients(oldSignal),[]);
  assert.deepEqual((await env.service.recipients(signal)).map(row=>row.wallet),[bob]);
  const input={signal,recipient:bob,keyRecord:buyerKey.key,box};
  const envelope=await env.service.grantSignal(input);
  assert.equal((await env.service.grantSignal(input)).key,envelope.key);
  assert.equal((await env.service.getEnvelope(signal,bob))?.key,envelope.key);
  await assert.rejects(env.service.grantSignal({...input,signal:oldSignal}),{code:'NOT_OWNER'});
  claim.createdAtBlock=signal.createdAtBlock;
  assert.deepEqual(await env.service.recipients(signal),[]);
  claim.createdAtBlock='105';
  signal.createdAtBlock='100000';
  assert.deepEqual(await env.service.recipients(signal),[]);
});

test('renewal evidence carries active claim dependencies and drops a completed term',async()=>{
  const env=setup();
  const plan=await env.service.publishPlan({priceWei:'100',requestId:crypto.randomUUID()});
  env.account(bob);
  const key=await env.service.registerKey({identity:{publicKey:'a'.repeat(43),backup:{iv:'a'.repeat(16),ciphertext:'b'.repeat(80)}},requestId:crypto.randomUUID()});
  const claim=await env.service.claim({planKey:plan.key,keyRecord:key.key,transactionHash:hash(9),requestId:crypto.randomUUID()});
  const active=await env.service.renewalEvidence(alice,bob,10400000);
  assert.equal(active.expiresAt,10300000+2*MEMBERSHIP_MS);
  assert.deepEqual(active.records.map(row=>row.key),[claim.key,plan.key,key.key]);
  const now=10300000+MEMBERSHIP_MS;
  const ended=await env.service.renewalEvidence(alice,bob,now);
  assert.deepEqual(ended.records,[]);
  assert.equal(ended.expiresAt,now+MEMBERSHIP_MS);
});

test('creator earnings count verified payments once and retain historical plan prices',async()=>{
  const env=setup();
  const plan=await env.service.publishPlan({priceWei:'100',requestId:crypto.randomUUID()});
  env.account(bob);
  const key=await env.service.registerKey({identity:{publicKey:'a'.repeat(43),backup:{iv:'a'.repeat(16),ciphertext:'b'.repeat(80)}},requestId:crypto.randomUUID()});
  const claim=await env.service.claim({planKey:plan.key,keyRecord:key.key,transactionHash:hash(9),requestId:crypto.randomUUID()});
  env.rows.push({...claim,key:hash(200),createdAtBlock:'200'});
  env.account(alice);
  await env.service.publishPlan({priceWei:'500',previousKey:plan.key,requestId:crypto.randomUUID()});
  const result=await env.service.earnings(alice);
  assert.equal(result.totalWei,'100');assert.equal(result.payments.length,1);
  assert.equal(result.payments[0]?.transactionHash,hash(9));
  env.state.value=1n;
  assert.equal((await env.service.earnings(alice)).totalWei,'0');
  env.client.getTransaction=async()=>{throw new Error('offline');};
  await assert.rejects(env.service.earnings(alice),{code:'NETWORK_UNAVAILABLE'});
});


test('read eligibility requires current and publication-time membership with owner bypass',async()=>{
 const env=setup(),plan=await env.service.publishPlan({priceWei:'100',requestId:crypto.randomUUID()});
 const publish=async()=>{env.account(alice);const id=crypto.randomUUID();return env.service.publishSignal({requestId:id,pointer:{format:'swarm-message/1',publicationId:id,swarmAddress:'a'.repeat(64),payloadHash:hash(1),source:'manual'}});};
 const old=await publish();
 assert.equal(await env.service.canReadSignal({signal:old,wallet:alice,now:99999999999}),true);
 env.account(bob);const claim=await env.service.claim({planKey:plan.key,transactionHash:hash(9),requestId:crypto.randomUUID()});
 const signal=await publish();const now=Number(signal.createdAtBlock)*100000;
 assert.equal(await env.service.canReadSignal({signal:old,wallet:bob,now}),false);
 assert.equal(await env.service.canReadSignal({signal,wallet:bob,now}),true);
 assert.equal(await env.service.canReadSignal({signal,wallet:bob,now:now+2*MEMBERSHIP_MS}),false);
 const same={...signal,createdAtBlock:claim.createdAtBlock};
 assert.equal(await env.service.canReadSignal({signal:same,wallet:bob,now}),false);
 // A late renewal cannot unlock a post from the unpaid gap.
 env.rows.push({...signal,key:hash(30000),createdAtBlock:'30000'});
 env.account(bob);const late=await env.service.claim({planKey:plan.key,transactionHash:hash(10),requestId:crypto.randomUUID()});
 late.createdAtBlock='40000';
 const gap={...signal,key:hash(31000),createdAtBlock:'31000'};
 assert.equal(await env.service.canReadSignal({signal:gap,wallet:bob,now:4000000001}),false);
});

test('Rabdi relayed claims prove the buyer payment and retain eligibility when indexing is delayed',async()=>{
 const {membershipPaymentData}=await import('../../../src/integrations/arkiv/community/membership-intent.ts');
 const env=setup();const service=createCreatorMemberships(env.events,{payments:env.client,rabdiPayments:env.client,blockTimestamp:async block=>Number(block)*100000});
 const plan=await service.publishPlan({priceWei:'100',chainId:7794095,requestId:crypto.randomUUID()});
 assert.equal(plan.data.chainId,7794095);
 const purchaseId=crypto.randomUUID();env.state.chainId=7794095;env.state.timestamp=10200n;env.state.input=membershipPaymentData({buyer:bob,creator:alice,planKey:plan.key,priceWei:'100',requestId:purchaseId});
 env.client.getTransaction=async({hash:tx}:any)=>({hash:tx,from:bob,to:alice,value:100n,input:env.state.input,blockNumber:102n,blockHash:hash(3)}) as any;
 env.client.getTransactionReceipt=async({hash:tx}:any)=>({transactionHash:tx,status:'success',blockNumber:102n,blockHash:hash(3)}) as any;
 env.state.head=200n;
 const claim=await env.events.append({type:'subscription-relay',actor:alice,subject:bob,scope:alice,requestId:crypto.randomUUID(),data:{planKey:plan.key,transactionHash:hash(77),purchaseId}});
 claim.createdAtBlock='120';
 assert.equal((await service.members(alice))[0]?.wallet,bob);
 assert.equal((await service.members(alice))[0]?.expiresAt,10200000+MEMBERSHIP_MS);
 assert.equal((await service.members(alice,105n))[0]?.wallet,bob);
 assert.equal((await service.subscriptions(bob))[0]?.creator,alice);
 env.rows.push({...claim,key:hash(888)});assert.equal((await service.members(alice))[0]?.expiresAt,10200000+MEMBERSHIP_MS);
 env.state.input='0x';assert.deepEqual(await service.members(alice),[]);
});
