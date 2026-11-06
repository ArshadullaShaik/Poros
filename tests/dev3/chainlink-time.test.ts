import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readChainlink} from '../../src/features/builder/market/chainlink.ts';
import {createLiveMarkets} from '../../src/features/builder/market/live.ts';

const localTime=1800000000000;
const word=(value:number)=>BigInt(value).toString(16).padStart(64,'0');
function oracleFixture({clock=()=>localTime,offset=180,age=0,chain='0x2105'}: {clock?:()=>number;offset?:number;age?:number;chain?:string}={}) {
 const calls:any[]=[];
 const fetcher=async(_url:any,init:any)=>{
  const batch=JSON.parse(init.body);calls.push(...batch);
  const seconds=Math.floor(clock()/1000)+offset;
  return Response.json(batch.map((call:any)=>({jsonrpc:'2.0',id:call.id,result:
   call.method==='eth_chainId'?chain:
   call.method==='eth_getBlockByNumber'?{number:'0x1234',timestamp:'0x'+seconds.toString(16)}:
   call.params[0].data==='0x313ce567'?'0x'+word(8):
   '0x'+[1,call.params[0].to.toLowerCase()==='0xbcf85224fc0756b9fa45aa7892530b47e10b6433'?0:250000000000,seconds-7200,seconds-age,1].map(word).join('')
  })));
 };
 return {fetcher,calls};
}

test('oracle freshness uses a pinned block when the local clock is behind the chain',async()=>{
 const fixture=oracleFixture();
 const result=await readChainlink({fetcher:fixture.fetcher,now:()=>localTime});
 assert.equal(result.priceUsd,'2500.000000');
 assert.ok(fixture.calls.some(call=>call.method==='eth_getBlockByNumber'));
 assert.ok(fixture.calls.filter(call=>call.method==='eth_call').every(call=>call.params[1]==='0x1234'));
});

test('block-based freshness still rejects stale answers, future answers, wrong chains and excessive clock drift',async()=>{
 for(const options of [{age:1201},{age:-1},{chain:'0x1'},{offset:301},{offset:-301}]){
  const fixture=oracleFixture(options);
  await assert.rejects(readChainlink({fetcher:fixture.fetcher,now:()=>localTime}));
 }
});

test('invalid latest-block data is rejected before any oracle contract is read',async()=>{
 for(const block of [null,{number:'latest',timestamp:'0x1234'},{number:'0x0',timestamp:'0x1234'},{number:'0x1234',timestamp:'0x0'}]){
  const fixture=oracleFixture();
  const fetcher=async(url:any,init:any)=>{
   const response=await fixture.fetcher(url,init);
   const rows=await response.json();
   for(const row of rows)if(row.id===5)row.result=block;
   return Response.json(rows);
  };
  await assert.rejects(readChainlink({fetcher,now:()=>localTime}),/invalid latest block/);
  assert.ok(fixture.calls.every(call=>call.method!=='eth_call'));
 }
});

test('display prices share an in-flight read even when it takes longer than the cache window',async()=>{
 let time=localTime,release!:()=>void,requests=0;
 const fixture=oracleFixture({clock:()=>time,offset:0});
 const markets=createLiveMarkets({now:()=>time,fetcher:async(...args:any[])=>{
  if(++requests===1)await new Promise<void>(resolve=>{release=resolve;});
  return fixture.fetcher(args[0],args[1]);
 }});
 const first=markets.displayPrice('eth-usdc');time+=11000;
 const second=markets.displayPrice('eth-usdc');
 try{assert.equal(first,second);}finally{release();}
 await Promise.all([first,second]);
 assert.equal(requests,2);
});

test('a failed display read can recover immediately instead of reusing a cached rejection',async()=>{
 let fail=true;
 const fixture=oracleFixture({offset:0});
 const markets=createLiveMarkets({now:()=>localTime,fetcher:async(...args:any[])=>{
  if(fail)throw new Error('Transient RPC outage');
  return fixture.fetcher(args[0],args[1]);
 }});
 await assert.rejects(markets.displayPrice('eth-usdc'));
 fail=false;
 assert.equal((await markets.displayPrice('eth-usdc')).priceUsd,'2500.000000');
});
