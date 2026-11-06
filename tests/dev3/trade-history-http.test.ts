import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeHistoryHandler} from '../../src/features/builder/server/trade-history.mjs';
import {openTradeState} from '../../src/features/builder/server/trade-state.ts';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../src/integrations/arkiv/package.json',import.meta.url));
test('unconfigured ledger reports unavailable rather than claiming a false empty trade history',async()=>{
 let status=0,payload:any;
 const response={setHeader(){},writeHead(s:number){status=s;return this;},end(v:string){payload=JSON.parse(v);}};
 await createTradeHistoryHandler({getRuntime:()=>null})({method:'GET',url:'/api/trade-history/report?trader=0x'+'a'.repeat(40),headers:{}},response);
 assert.equal(status,503);assert.equal(payload.error.code,'LEDGER_NOT_CONFIGURED');assert.equal(payload.ok,false);
});
test('source links require real operation-bound signatures and cannot replay or supply economics',async()=>{
 const {privateKeyToAccount}=require('viem/accounts');const account=privateKeyToAccount('0x'+'1'.repeat(64)),trader=account.address.toLowerCase(),origin='http://localhost:4325';
 const source={kind:'flash',sourceId:'flash:'+trader,wallet:trader,chainFamily:'evm'},state=openTradeState(':memory:');
 const runtime={origin,state,sourceAdapter:{async validateBinding(){}},repository:{},ledger:{}};
 const handler=createTradeHistoryHandler({getRuntime:()=>runtime as any});
 async function post(action:string,body:any){let status=0,payload:any;const request:any=Readable.from([Buffer.from(JSON.stringify(body))]);request.method='POST';request.url='/api/trade-history/'+action;request.headers={'content-type':'application/json',origin,host:'localhost:4325'};await handler(request,{setHeader(){},writeHead(s:number){status=s;return this;},end(v:string){payload=JSON.parse(v);}});return {status,payload};}
 try{
  const challenge=await post('challenge',{trader,source,operation:'link'});assert.equal(challenge.status,200);
  const signature=await account.signMessage({message:challenge.payload.data.message});
  assert.equal((await post('link',{nonce:challenge.payload.data.nonce,signature,profit:'99999'})).status,400);assert.equal(state.sources().length,0);
  assert.equal((await post('link',{nonce:challenge.payload.data.nonce,signature:'0x'+'0'.repeat(130)})).status,400);
  const results=await Promise.all([post('link',{nonce:challenge.payload.data.nonce,signature}),post('link',{nonce:challenge.payload.data.nonce,signature})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(state.sources(trader).length,1);assert.equal(state.outbox()[0]!.input.kind,'source-link');
 }finally{state.close();}
});
test('status endpoint does not return credentials and cross-origin writes are rejected',async()=>{
 let status=0,payload:any;const response={setHeader(){},writeHead(s:number){status=s;return this;},end(v:string){payload=JSON.parse(v);}};
 const handler=createTradeHistoryHandler({getRuntime:()=>null});
 await handler({method:'GET',url:'/api/trade-history/status',headers:{}},response);assert.equal(status,200);assert.equal(payload.data.configured,false);
 await handler({method:'POST',url:'/api/trade-history/link',headers:{origin:'https://foreign.example',host:'localhost'}},response);assert.equal(status,403);
});
