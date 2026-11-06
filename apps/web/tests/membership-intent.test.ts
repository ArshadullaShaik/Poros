import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {membershipPaymentData,verifySignalAuthor,signalCreator,relayRequestId} from '../../../src/integrations/arkiv/community/membership-intent.ts';
import {memberContentHash} from '../../../src/integrations/arkiv/community/member-content.ts';
const signer=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`),creator=signer.address.toLowerCase() as `0x${string}`;
test('one exact publication signature proves creator identity independently of the relayer',async()=>{
 const id=crypto.randomUUID(),hash=memberContentHash({title:'Private',body:'Rules',source:'manual'});
 const proof={domain:'poros:member-content:1',operation:'publish',relayActor:'0x'+'2'.repeat(40),chainId:7794095,wallet:creator,origin:'http://127.0.0.1:4325',nonce:crypto.randomUUID(),issuedAt:1000,expiresAt:301000,target:{publicationId:id,payloadHash:hash,retryUncertain:false},purpose:'Publish this private strategy to my paid members.'};
 const message=JSON.stringify(proof),signature=await signer.signMessage({message});
 const signal:any={type:'private-signal-relay',source:'arkiv',actor:'0x'+'2'.repeat(40),subject:creator,scope:'global',requestId:relayRequestId('publish',creator,id),data:{format:'swarm-message/1',publicationId:id,payloadHash:hash,swarmAddress:'a'.repeat(64),source:'manual',creator,authorization:{message,signature}}};
 await verifySignalAuthor(signal);assert.equal(signalCreator(signal),creator);
 signal.actor='0x'+'3'.repeat(40);await assert.rejects(verifySignalAuthor(signal));
 signal.actor=proof.relayActor;signal.data.payloadHash='0x'+'b'.repeat(64);await assert.rejects(verifySignalAuthor(signal));
});
test('Rabdi purchase calldata binds price, creator, plan and original intent',()=>{
 const intent={buyer:creator,creator:('0x'+'2'.repeat(40)) as `0x${string}`,planKey:('0x'+'a'.repeat(64)) as `0x${string}`,priceWei:'100',requestId:crypto.randomUUID()};
 assert.notEqual(membershipPaymentData(intent),membershipPaymentData({...intent,priceWei:'101'}));
 assert.notEqual(membershipPaymentData(intent),membershipPaymentData({...intent,requestId:crypto.randomUUID()}));
 assert.equal(relayRequestId('publish',creator,intent.requestId),relayRequestId('publish',creator,intent.requestId));
});
