import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {privateKeyToAccount} from 'viem/accounts';
import {createMemberContentHandler} from '../../../src/features/builder/server/member-content-api.mjs';
import {openMemberContentState} from '../../../src/features/builder/server/member-content-state.ts';
const account=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`),signalKey='0x'+'a'.repeat(64);
async function request(handler:any,action:string,body:any,origin='https://poros.example',extra:any={}){
 const req:any=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/api/member-content/'+action;req.headers={'content-type':'application/json',origin,host:'poros.example',...extra};req.socket={remoteAddress:'127.0.0.1'};
 const res:any={status:200,headers:{},setHeader(k:string,v:string){this.headers[k]=v;},writeHead(n:number){this.status=n;return this;},end(data:string){this.data=JSON.parse(data);return this;}};
 await handler(req,res);return res;
}
test('member API binds wallet, origin, target and nonce and denies replay before reading content',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32).fill(4));let reads=0;
 const handler=createMemberContentHandler({now:()=>1000,getRuntime:()=>({origin:'https://poros.example',state,service:{upload:async()=>{throw new Error("unused");},read:async()=>{reads++;return {content:{title:'Private',body:'Rules',source:'manual' as const},expiresAt:5000};}}})});
 try{
  const challenge=await request(handler,'challenge',{wallet:account.address.toLowerCase(),operation:'read',target:{signalKey}});assert.equal(challenge.status,200);
  const {nonce,message}=challenge.data.data;const signature=await account.signMessage({message});
  const body={nonce,signature};assert.equal((await request(handler,'read',body)).status,200);assert.equal(reads,1);
  assert.equal((await request(handler,'read',body)).status,401);assert.equal(reads,1);
  assert.equal((await request(handler,'challenge',{},'https://evil.example')).status,403);
  assert.equal((await request(handler,'challenge',{},'https://poros.example',{host:'evil.example'})).status,403);
  assert.equal((await request(handler,'challenge',{},'')).status,403);
  assert.equal((await request(handler,'challenge',{wallet:account.address,operation:'read',target:{signalKey,extra:1}})).status,400);
 }finally{state.close();}
});
test('unconfigured content API fails explicitly without requiring trade credentials',async()=>{
 const handler=createMemberContentHandler({getRuntime:()=>null});const result=await request(handler,'read',{});
 assert.equal(result.status,503);assert.equal(result.data.error.code,'SWARM_NOT_CONFIGURED');
});


test('a feed proof authorizes only its exact message set and uses a single signature',async()=>{
 const state=openMemberContentState(':memory:',new Uint8Array(32).fill(7));let now=1000;
 const keys=[signalKey,'0x'+'b'.repeat(64)];const seen:string[]=[];
 const handler=createMemberContentHandler({now:()=>now,getRuntime:()=>({origin:'https://poros.example',state,service:{upload:async()=>{throw new Error('unused');},read:async({signalKey}:any)=>{seen.push(signalKey);return {content:{title:'T',body:'B',source:'manual' as const},expiresAt:5000};}}})});
 try{
  const get=()=>request(handler,'challenge',{wallet:account.address.toLowerCase(),operation:'read',target:{signalKeys:keys}});
  const challenge=(await get()).data.data;
  const signature=await account.signMessage({message:challenge.message});
  assert.equal((await request(handler,'upload',{nonce:challenge.nonce,signature,content:{title:'T',body:'B',source:'manual'}})).status,401);
  assert.equal((await request(handler,'read',{nonce:challenge.nonce,signature,signalKeys:[keys[0]]})).status,400);
  const result=await request(handler,'read',{nonce:challenge.nonce,signature});
  assert.equal(result.status,200);assert.deepEqual(seen,keys);assert.equal(result.data.data.messages.length,2);
  const stale=(await get()).data.data;const staleSignature=await account.signMessage({message:stale.message});now+=300000;
  assert.equal((await request(handler,'read',{nonce:stale.nonce,signature:staleSignature})).status,401);
 }finally{state.close();}
});
