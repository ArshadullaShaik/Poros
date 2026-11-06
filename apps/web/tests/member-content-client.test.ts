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
