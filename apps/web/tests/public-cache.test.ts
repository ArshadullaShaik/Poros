import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createPublicReadCache} from '../src/public-cache.ts';
class Storage {clear(){this.values.clear();}values=new Map<string,string>();get length(){return this.values.size;}key(i:number){return [...this.values.keys()][i]??null;}getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}removeItem(k:string){this.values.delete(k);}}
const valid=(v:unknown):v is {name:string}=>!!v&&typeof (v as any).name==='string';
test('public data survives reload and stale data returns immediately while one background refresh updates it',async()=>{
 const storage=new Storage();let time=10000,calls=0,resolve:any;
 const cache=createPublicReadCache({storage,now:()=>time});const load=async()=>{calls++;return {name:'Old'};};
 await cache.read('communities:{}',load,valid);await cache.read('communities:{}',load,valid);assert.equal(calls,1);
 const reopened=createPublicReadCache({storage,now:()=>time});assert.equal((await reopened.read('communities:{}',load,valid)).name,'Old');assert.equal(calls,1);
 time+=31000;const pending=()=>{calls++;return new Promise<{name:string}>(done=>{resolve=done;});};
 assert.equal((await reopened.read('communities:{}',pending,valid)).name,'Old');assert.equal((await reopened.read('communities:{}',pending,valid)).name,'Old');assert.equal(calls,2);
 resolve({name:'New'});await new Promise(done=>setImmediate(done));assert.equal((await reopened.read('communities:{}',load,valid)).name,'New');
});
test('cache handles network failures, corrupt storage, expiry, and clearing during a request without restoring invalidated data',async()=>{
 const storage=new Storage();let time=10000;
 const cache=createPublicReadCache({storage,now:()=>time});await cache.read('communities:{}',async()=>({name:'Saved'}),valid);
 time+=31000;assert.equal((await cache.read('communities:{}',async()=>{throw Error('Offline');},valid)).name,'Saved');await new Promise(done=>setImmediate(done));
 cache.clear();let resolve:any;const pending=cache.read('communities:{}',()=>new Promise<{name:string}>(done=>{resolve=done;}),valid);await Promise.resolve();cache.clear();resolve({name:'Old write'});await pending;assert.equal(storage.length,0);
 await cache.read('communities:{}',async()=>({name:'Saved'}),valid);time+=301000;let calls=0;assert.equal((await cache.read('communities:{}',async()=>{calls++;return {name:'Fresh'};},valid)).name,'Fresh');assert.equal(calls,1);
 storage.setItem(storage.key(0)!,'broken');const next=createPublicReadCache({storage,now:()=>time});await assert.rejects(next.read('communities:{}',async()=>null as any,valid));
});

test('public list cache validates summaries and never wraps write or membership methods',async()=>{
 const {cachedPublicLists,validCommunities,validStrategies}=await import('../src/public-cache.ts');
 const key='0x'+'1'.repeat(64),wallet='0x'+'2'.repeat(40),page={items:[{communityKey:key,creator:wallet,owner:wallet,name:'Room',description:'Public',contentHash:key,expiresAtBlock:'999',source:'arkiv'}],source:'arkiv',offset:0,limit:20,skipped:0,blockNumber:'100',nextOffset:null};
 assert.equal(validCommunities(page),true);assert.equal(validCommunities({...page,items:[{...page.items[0],owner:'invalid'}]}),false);
 const summaries={...page,items:[{strategyId:key,rootVersionKey:key,creator:wallet,name:'Rules',category:'signal',executionChainId:8453,tokenIn:wallet,tokenOut:wallet,expiresAtBlock:'999',source:'arkiv'}]};assert.equal(validStrategies(summaries),true);
 let calls=0;const api=cachedPublicLists({listCommunities:async()=>{calls++;return page;},listStrategies:async()=>summaries} as any,createPublicReadCache());await api.listCommunities();await api.listCommunities();assert.equal(calls,1);assert.equal('reconcileRequest' in api,false);assert.equal('getMembership' in api,false);
});

test('failed public refreshes back off while saved public data stays available, and clearing permits a fresh read',async()=>{
 let time=0,calls=0;const cache=createPublicReadCache({now:()=>time});
 await cache.read('feed',async()=>({name:'Saved'}),valid);time=31000;
 const fail=async()=>{calls++;throw new Error('Rate limited');};
 await cache.read('feed',fail,valid);await new Promise(resolve=>setImmediate(resolve));
 for(let i=0;i<10;i++)assert.equal((await cache.read('feed',fail,valid)).name,'Saved');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 time+=15001;await cache.read('feed',fail,valid);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);
 cache.clear();assert.equal((await cache.read('feed',async()=>({name:'New'}),valid)).name,'New');
});
