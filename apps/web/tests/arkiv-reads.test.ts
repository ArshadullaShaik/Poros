import test from 'node:test';
import assert from 'node:assert/strict';
import {createArkivReads} from '../../../src/features/builder/server/arkiv-reads.mjs';
const query=(text='public feed')=>({method:'arkiv_query',params:[text]});
const signal=()=>AbortSignal.timeout(10000);
const success=()=>({status:200,payload:{jsonrpc:'2.0',result:[]}});
test('shared Arkiv reads collapse identical requests but do not cache query or membership results',async()=>{
 const read=createArkivReads();let calls=0,finish!:()=>void;
 const load=async()=>{calls++;await new Promise<void>(resolve=>{finish=resolve;});return success();};
 const a=read(query(),load,signal()),b=read(query(),load,signal());
 await Promise.resolve();assert.equal(calls,1);finish();await Promise.all([a,b]);
 await read(query(),async()=>{calls++;return success();},signal());assert.equal(calls,2);
});
test('Arkiv upstream concurrency is bounded and queued cancelled reads never execute',async()=>{
 const read=createArkivReads();let active=0,peak=0,calls=0;const release:Function[]=[];
 const load=async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>release.push(resolve));active--;return success();};
 const jobs=Array.from({length:8},(_,i)=>read(query(String(i)),load,signal()));
 const abort=new AbortController();const cancelled=read(query('cancelled'),load,abort.signal);const rejected=assert.rejects(cancelled);abort.abort();
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,4);
 release.splice(0).forEach(resolve=>resolve());await new Promise(resolve=>setImmediate(resolve));
 release.splice(0).forEach(resolve=>resolve());await Promise.all(jobs);await rejected;
 assert.equal(peak,4);assert.equal(calls,8);
});
test('rate limits cool down all queries and are never cached as successful results',async()=>{
 let time=0,calls=0;const read=createArkivReads({now:()=>time});
 const load=async()=>{calls++;return {status:429,retryAfter:20,payload:{error:{code:429}}};};
 assert.equal((await read(query(),load,signal())).retryAfter,20);
 time=5000;assert.equal((await read(query('other'),load,signal())).retryAfter,15);assert.equal(calls,1);
 time=20001;await read(query(),async()=>{calls++;return success();},signal());assert.equal(calls,2);
});
test('only chain identity is briefly cached; entity and receipt verification remain fresh',async()=>{
 const read=createArkivReads();let calls=0;const load=async()=>{calls++;return success();};
 for(let i=0;i<2;i++)await read({method:'eth_chainId',params:[]},load,signal());assert.equal(calls,1);
 for(const method of ['arkiv_getEntity','eth_getTransactionReceipt','arkiv_getBlockTiming'])
  for(let i=0;i<2;i++)await read({method,params:[]},load,signal());
 assert.equal(calls,7);
});

test('RPC proxy shares work while preserving caller IDs and returns Retry-After during cooldown',async()=>{
 const {Readable}=await import('node:stream');
 const {createArkivProxy}=await import('../../../src/features/builder/server/rpc.mjs');
 let calls=0,finish!:()=>void;
 const proxy=createArkivProxy(async(_url:unknown,init?:RequestInit)=>{
  calls++;const request=JSON.parse(String(init?.body));
  if(calls===1)await new Promise<void>(resolve=>{finish=resolve;});
  return Response.json({jsonrpc:'2.0',id:request.id,result:['public']});
 });
 async function call(handler:Function,id:number,method='arkiv_query'){
  const req=Object.assign(Readable.from([Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method,params:method==='arkiv_query'?['same query']:[]}))]),{method:'POST',headers:{host:'localhost','content-type':'application/json'}});
  let status=0,payload:any;const headers:Record<string,string>={};
  const response={setHeader:(k:string,v:string)=>{headers[k]=v;},writeHead:(code:number)=>{status=code;return response;},end:(text:string)=>{payload=JSON.parse(text);}};
  await handler(req,response);return {status,payload,headers};
 }
 const first=call(proxy,101),second=call(proxy,202);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);finish();
 const [a,b]=await Promise.all([first,second]);assert.equal(a.payload.id,101);assert.equal(b.payload.id,202);assert.deepEqual(a.payload.result,b.payload.result);
 await call(proxy,303);assert.equal(calls,2);
 let limitedCalls=0;
 const limited=createArkivProxy(async()=>{limitedCalls++;return new Response(null,{status:429,headers:{'Retry-After':'20'}});});
 const one=await call(limited,1),two=await call(limited,2,'eth_blockNumber');
 assert.equal(one.status,429);assert.equal(two.status,429);assert.equal(two.payload.id,2);assert.equal(limitedCalls,1);assert.ok(Number(two.headers['Retry-After'])>0);
});
