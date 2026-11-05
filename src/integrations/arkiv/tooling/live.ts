import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPublicClient,createWalletClient,EntityMutationError,ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { http,type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createArkivStore,encodeValues } from '../client.ts';
import { CHAIN_ID,Schemas } from '../schema.ts';
import { buildCommunity,buildPost,communityValues,postValues } from '../records.ts';

// This opt-in test utility is excluded from the production build and exports.
export async function runLiveSmoke():Promise<Record<string,unknown>> {
  assert.equal(process.env.ARKIV_RUN_LIVE_TESTS,'1','Explicit live-test opt-in required');
  const a=process.env.ARKIV_TEST_PRIVATE_KEY_A,b=process.env.ARKIV_TEST_PRIVATE_KEY_B,accessKey=process.env.ARKIV_ACCESS_KEY;
  assert.ok(a&&/^0x[\da-f]{64}$/i.test(a),'Disposable key A missing/invalid');
  assert.ok(b&&/^0x[\da-f]{64}$/i.test(b),'Disposable key B missing/invalid');
  assert.ok(accessKey,'A Rabdi access key is required for live writes');
  const accountA=privateKeyToAccount(a as Hex),accountB=privateKeyToAccount(b as Hex);
  assert.notEqual(accountA.address,accountB.address,'Use distinct disposable accounts');
  const chain=rabdi({accessKey});const transport=http(undefined,{retryCount:0,timeout:15_000});
  const reader=createPublicClient({chain,transport});assert.equal(await reader.getChainId(),CHAIN_ID);
  assert.ok(await reader.getBalance({address:accountA.address})>0n,'Fund disposable A with tGLM');
  assert.ok(await reader.getBalance({address:accountB.address})>0n,'Fund disposable B with tGLM');
  const writerA=createWalletClient({chain,transport,account:accountA}),writerB=createWalletClient({chain,transport,account:accountB});
  const record=buildCommunity(accountA.address.toLowerCase() as Hex,randomUUID(),'Disposable Arkiv proof','Live SDK smoke; intentionally public.');
  const created=await writerA.createEntity(Schemas.communities,encodeValues(communityValues(record)),{expiration:ExpirationTime.fromMinutes(10)});
  const store=createArkivStore({accessKey});
  const read=await store.getCommunity({communityKey:created.entityKey});assert.equal(read.contentHash,record.contentHash);
  assert.equal(read.creator,accountA.address.toLowerCase());assert.equal(read.source,'arkiv');
  await assert.rejects(writerB.deleteEntity({entityKey:created.entityKey}),error=>error instanceof EntityMutationError&&/owner|unauthoriz/i.test(error.message));
  const post=buildPost(accountA.address.toLowerCase() as Hex,randomUUID(),created.entityKey,'Disposable readonly/expiration proof');
  const posted=await writerA.createEntity(Schemas.posts,encodeValues(postValues(post)),{expiration:ExpirationTime.fromSeconds(120),flags:{readonly:true}});
  await assert.rejects(writerA.patchEntity(Schemas.posts,posted.entityKey,{set:encodeValues(postValues(post))}),error=>error instanceof EntityMutationError&&/read.?only/i.test(error.message));
  const extended=await writerA.extendEntity({entityKey:created.entityKey,expiration:ExpirationTime.fromDays(1)});
  assert.ok(extended.expiresAt>created.expiresAt);
  const deleted=await writerA.deleteEntity({entityKey:created.entityKey});
  await assert.rejects(store.getCommunity({communityKey:created.entityKey}),{code:'NOT_FOUND_OR_EXPIRED'});
  assert.equal((await store.listPosts({communityKey:created.entityKey})).items[0]?.postKey,posted.entityKey);
  const deadline=Date.now()+180_000;
  while(BigInt((await reader.getBlockTiming()).currentBlock)<posted.expiresAt){
    assert.ok(Date.now()<deadline,'Expiration proof timed out; preserve manifest and inspect chain');
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  await assert.rejects(reader.getEntity(posted.entityKey));
  return {mode:'live-sdk-smoke',chainId:CHAIN_ID,writerA:accountA.address,writerB:accountB.address,
    communityKey:created.entityKey,postKey:posted.entityKey,createTx:created.txHash,postTx:posted.txHash,
    extendTx:extended.txHash,deleteTx:deleted.txHash,postExpiresAtBlock:String(posted.expiresAt),
    verifiedAt:new Date().toISOString(),scope:'SDK mutations and production read decoding; browser signing and real strategy schema remain separate gates'};
}
