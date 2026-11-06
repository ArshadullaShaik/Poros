import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberContentClient} from '../src/member-content.ts';
const account=('0x'+'1'.repeat(40)) as `0x${string}`,key=('0x'+'a'.repeat(64)) as `0x${string}`;
test('one feed proof opens a bounded group of messages and account changes discard results',async()=>{
 let current=account,signatures=0,changed=false;
 const wallet:any={getContext:async()=>({account:current}),signMessage:async()=>{signatures++;return '0x1234';}};
 const fetcher:any=async(url:string,init:any)=>{
  const body=JSON.parse(init.body);
  if(url.endsWith('challenge')){assert.deepEqual(body.target,{signalKeys:[key]});return Response.json({ok:true,data:{nonce:'nonce',message:JSON.stringify({domain:'poros:member-content:1',wallet:body.wallet,operation:body.operation,target:body.target,nonce:'nonce',expiresAt:Date.now()+300000})}});}
  if(changed)current=('0x'+'2'.repeat(40)) as `0x${string}`;
  return Response.json({ok:true,data:{messages:[{signalKey:key,content:{title:'Private',body:'Rules',source:'manual'},expiresAt:Date.now()+10000}]}});
 };
 const client=createMemberContentClient({wallet,fetcher});
 assert.equal((await client.readMany([key]))[0]?.content.body,'Rules');assert.equal(signatures,1);
 changed=true;await assert.rejects(client.readMany([key]),/Wallet account changed/);
});

test('private publishing uses one signature, resumes accepted work without resigning and never sends a wallet transaction',async()=>{
 const {privateKeyToAccount}=await import('viem/accounts');
 const {memberContentHash}=await import('../../../src/integrations/arkiv/community/member-content.ts');
 const {relayRequestId}=await import('../../../src/integrations/arkiv/community/membership-intent.ts');
 const signer=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`),owner=signer.address.toLowerCase();
 const content={title:'Private',body:'Rules',source:'manual' as const},publicationId=crypto.randomUUID();let signatures=0,job:any=null;
 const wallet:any={getContext:async()=>({account:owner}),signMessage:async(message:string)=>{signatures++;return signer.signMessage({message});},sendTransaction:()=>{throw Error('Unexpected wallet transaction');}};
 const fetcher:any=async(url:string,init:any)=>{
  const body=JSON.parse(init.body);
  if(url.endsWith('status'))return Response.json({ok:true,data:job});
  const now=Date.now();
  if(url.endsWith('challenge'))return Response.json({ok:true,data:{nonce:publicationId,message:JSON.stringify({...body,domain:'poros:member-content:1',chainId:7794095,relayActor:account,purpose:'Publish this strategy.',origin:'https://poros.example',nonce:publicationId,issuedAt:now,expiresAt:now+300000})}});
  throw new Error('Unexpected endpoint');
 };
 let authorization:any;
 const post:any=async(url:string,init:any)=>{
  if(url.endsWith('challenge')){const response=await fetcher(url,init);const result=await response.clone().json();authorization={message:result.data.message};return response;}
  if(url.endsWith('publish')){
   authorization.signature=JSON.parse(init.body).signature;
   job={phase:'done',result:{type:'private-signal-relay',source:'arkiv',actor:account,subject:owner,scope:'global',requestId:relayRequestId('publish',owner as any,publicationId),data:{format:'swarm-message/1',publicationId,swarmAddress:'a'.repeat(64),payloadHash:memberContentHash(content),source:'manual',creator:owner,authorization}}};return Response.json({ok:true,data:job});
  }
  return fetcher(url,init);
 };
 const client=createMemberContentClient({wallet,fetcher:post});
 await client.publish({publicationId,content});await client.publish({publicationId,content});assert.equal(signatures,1);
});
