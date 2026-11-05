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


test('Arkiv proxy forwards read methods and keeps the server access key out of responses',async()=>{
  const previous=process.env.ARKIV_ACCESS_KEY;
  process.env.ARKIV_ACCESS_KEY='test-server-key';
  let requests=0;
  const server=createDemoServer({fetcher:async(url:URL,init:RequestInit)=>{
    requests++;
    assert.ok(url.pathname.endsWith('/test-server-key'));
    const request=JSON.parse(String(init.body));
    return Response.json({jsonrpc:'2.0',id:request.id,result:[]});
  }});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url='http://127.0.0.1:'+server.address().port+'/api/arkiv-rpc';
    const call=(method:string,params:unknown[]=[],headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    const success=await call('arkiv_query',['SELECT * FROM entities LIMIT 1']);
    assert.equal(success.status,200);
    assert.equal((await success.text()).includes('test-server-key'),false);
    assert.equal((await call('eth_sendRawTransaction',['0x00'])).status,400);
    assert.equal((await call('arkiv_getBlockTiming',[],{Origin:'https://evil.test'})).status,403);
    const omitted=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'eth_chainId'})});
    assert.equal(omitted.status,200);
    assert.equal(requests,2);
  } finally {
    await new Promise<void>(resolve=>server.close(resolve));
    if(previous===undefined)delete process.env.ARKIV_ACCESS_KEY;else process.env.ARKIV_ACCESS_KEY=previous;
  }
});
