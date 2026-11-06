import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createBackendProxy,createBackendGateway} from '../../../src/features/builder/server/deployment.mjs';
async function listen(handler:any){const server=createServer(handler);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as any;return {url:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};}
test('deployment proxy preserves signed payload and browser origin while the backend rejects untrusted traffic',async()=>{
 const secret='a'.repeat(64),origin='https://poros.example';let calls=0;
 const backend=await listen(createBackendGateway({secret,origin,handler:async(req:any,res:any)=>{
  calls++;let body='';for await(const chunk of req)body+=chunk;
  assert.equal(req.porosClientIp,'127.0.0.1');assert.equal(req.headers.host,'poros.example');assert.equal(req.headers.origin,origin);assert.equal(req.headers.authorization,'Bearer client-key');
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({path:req.url,body}));
 }}));
 const front=await listen(createBackendProxy({url:backend.url,secret}));
 try{
  const body=JSON.stringify({nonce:'exact-nonce',signature:'exact-signature'});
  const response=await fetch(front.url+'/api/member-content/read?x=1',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer client-key','x-poros-client-ip':'203.0.113.4'},body});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{path:'/api/member-content/read?x=1',body});
  assert.equal((await fetch(backend.url+'/api/member-content/read',{method:'POST',headers:{Origin:origin},body})).status,403);
  assert.equal((await fetch(front.url+'/api/member-content/read',{method:'POST',headers:{Origin:'https://evil.example'},body})).status,403);assert.equal(calls,1);
  assert.equal((await fetch(backend.url+'/healthz')).status,200);
 }finally{await front.close();await backend.close();}
});
test('deployment proxy requires a fixed HTTPS backend and a secret',()=>{
 assert.throws(()=>createBackendProxy({url:'http://public.example',secret:'a'.repeat(64)}));
 assert.throws(()=>createBackendProxy({url:'https://public.example/path',secret:'a'.repeat(64)}));
 assert.throws(()=>createBackendProxy({url:'https://public.example',secret:''}));
});
