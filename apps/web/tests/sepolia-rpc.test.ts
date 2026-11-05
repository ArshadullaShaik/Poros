import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The local Node host is JavaScript.
import { createDemoServer } from '../../../src/features/builder/demo/server.mjs';

test('Sepolia proxy permits bounded reads and rejects signing and foreign origins',async()=>{
  let requests=0;
  const server=createDemoServer({fetcher:async(_url:URL,init:RequestInit)=>{
    requests++;
    const request=JSON.parse(String(init.body));
    return Response.json({jsonrpc:'2.0',id:request.id,result:'0xaa36a7'});
  }});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/api/sepolia-rpc';
    const call=(method:string,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[]})});
    const success=await call('eth_chainId');assert.equal(success.status,200);assert.equal((await success.json()).result,'0xaa36a7');
    assert.equal((await call('eth_sendTransaction')).status,400);
    assert.equal((await call('eth_chainId',{Origin:'https://evil.test'})).status,403);
    assert.equal(requests,1);
  } finally {await new Promise<void>(resolve=>server.close(resolve));}
});
