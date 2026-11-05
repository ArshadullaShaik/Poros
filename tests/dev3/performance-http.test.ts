import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDemoServer} from '../../src/features/builder/demo/server.mjs';
test('performance endpoint limits reads to one requested wallet and rejects cross-site requests',async()=>{
 let calls=0;
 const server=createDemoServer({fetcher:async(url:any,init:any)=>{
  calls++;assert.match(String(url),/\/orders\?funderAddress=0x[a]{40}&pageSize=50$/);assert.equal(init.method,'GET');
  return Response.json({orders:[],nextPageToken:null});
 }});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const path='/api/performance?wallet=0x'+'a'.repeat(40);
 try{
  assert.equal((await fetch(base+path,{headers:{Origin:'https://other.test'}})).status,403);
  assert.equal((await fetch(base+path,{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/performance')).status,400);assert.equal(calls,0);
  const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{ok:true,data:{complete:true,fills:0,feesUsd:'0',markets:[]}});
  await fetch(base+path);assert.equal(calls,1);
 }finally{server.close();await once(server,'close');}
});
