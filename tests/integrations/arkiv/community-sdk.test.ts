import test from 'node:test';
import assert from 'node:assert/strict';
import { createArkivEventRepository } from '../../../src/integrations/arkiv/community/repository.ts';
import {buildEvent} from '../../../src/integrations/arkiv/community/events.ts';
import {recordBytes} from '../../../src/integrations/arkiv/codec.ts';
import {alice} from './fixtures.ts';
test('concurrent profile and membership reads share a head check without retaining stale heads',async()=>{
  let timings=0;
  const repository=createArkivEventRepository({publicTransport:(()=>({config:{key:'head-test',name:'head-test',type:'custom',retryCount:0},request:async({method}:{method:string})=>{
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='arkiv_getBlockTiming'){timings++;return {current_block:'0x64',current_block_time:1,duration:2};}
    if(method==='arkiv_query')return {data:[],blockNumber:'0x64'};
    throw new Error(method);
  }})) as never});
  await Promise.all([repository.scan({type:'creator-plan'}),repository.scan({type:'subscription'}),repository.scan({type:'encryption-key'}),repository.scan({type:'profile'})]);
  assert.equal(timings,1);
  await repository.scan({type:'subscription'});
  assert.equal(timings,2);
});
test('social SDK uses a separate typed namespace and bounded inclusive block polling without a wallet',async()=>{
  const queries:string[]=[];
  const repository=createArkivEventRepository({publicTransport:(()=>({config:{key:'test',name:'test',type:'custom',retryCount:0,retryDelay:0,timeout:1000},request:async({method,params=[]}:{method:string;params?:unknown[]})=>{
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='arkiv_getBlockTiming')return {current_block:'0x64',current_block_time:1,duration:2};
    if(method==='arkiv_query'){queries.push(String(params[0]));return {data:[],blockNumber:'0x64'};}
    throw new Error(method);
  }})) as never});
  assert.deepEqual(await repository.scan({type:'message',scope:`0x${'ab'.repeat(32)}`,afterBlock:'99'}),[]);
  assert.ok(queries[0]?.includes('ethmumbai.social.v1.events'));
  assert.match(queries[0]!,/eventType = str\('message'\)/);
  assert.doesNotMatch(queries[0]!,/\$createdAt/);
  await assert.rejects(repository.actor(),{code:'WALLET_REQUIRED'});
});
test('public SDK scans skip malformed outsider records, but own-author state reads remain fail closed',async()=>{
  const scope=`0x${'aa'.repeat(32)}`;
  const record=buildEvent({actor:alice,type:'message',subject:scope,scope,requestId:crypto.randomUUID(),data:{body:'Public valid message'}});
  const attributes=[{name:'arkiv.schema',type:'str',value:'ethmumbai.social.v1.events'},
    ...Object.entries({eventType:'message',subject:scope,scope,requestId:record.requestId}).map(([name,value])=>({name,type:'str',value})),
    {name:'record',type:'bytes',value:`0x${Buffer.from(recordBytes(record)).toString('hex')}`}];
  const raw={key:`0x${'01'.repeat(32)}`,creator:alice,owner:alice,createdAt:'0x5a',updatedAt:'0x5a',expiresAt:'0x100000',creationFlags:{readonly:true,permissionlessExtension:false,raw:'0x1'},attributes};
  const invalid={...raw,key:`0x${'02'.repeat(32)}`,owner:`0x${'22'.repeat(20)}`};
  const transport=()=>({config:{key:'t',name:'t',type:'custom',retryCount:0,retryDelay:0,timeout:1000},request:async({method}:{method:string})=>{
    if(method==='eth_chainId')return '0x76edaf';if(method==='arkiv_getBlockTiming')return {current_block:'0x64',current_block_time:1,duration:2};
    if(method==='arkiv_query')return {data:[raw,invalid],blockNumber:'0x64'};throw new Error(method);
  }});
  const repository=createArkivEventRepository({publicTransport:transport as never});
  assert.equal((await repository.scan({type:'message',scope})).length,1);
  assert.equal((await repository.scan({type:'message',scope,afterBlock:'91'})).length,0);
  await assert.rejects(repository.scan({type:'message',scope,actor:alice}),{code:'UNTRUSTED_RECORD'});
});
test('SDK scan overflow never returns a truncated successful community history',async()=>{
  const scope=`0x${'ab'.repeat(32)}`;let queries=0;
  const record=buildEvent({actor:alice,type:'message',subject:scope,scope,requestId:crypto.randomUUID(),data:{body:'Message'}});
  const attributes=[{name:'arkiv.schema',type:'str',value:'ethmumbai.social.v1.events'},
    ...Object.entries({eventType:'message',subject:scope,scope,requestId:record.requestId}).map(([name,value])=>({name,type:'str',value})),
    {name:'record',type:'bytes',value:`0x${Buffer.from(recordBytes(record)).toString('hex')}`}];
  const transport=()=>({config:{key:'t',name:'t',type:'custom',retryCount:0,retryDelay:0,timeout:1000},request:async({method}:{method:string})=>{
    if(method==='eth_chainId')return '0x76edaf';if(method==='arkiv_getBlockTiming')return {current_block:'0x64',current_block_time:1,duration:2};
    if(method==='arkiv_query'){const page=queries++;return {blockNumber:'0x64',data:Array.from({length:page<5?100:1},(_,i)=>({
      key:`0x${(page*100+i+1).toString(16).padStart(64,'0')}`,creator:alice,owner:alice,createdAt:'0x5a',updatedAt:'0x5a',expiresAt:'0x100000',
      creationFlags:{readonly:true,permissionlessExtension:false,raw:'0x1'},attributes}))};}throw new Error(method);
  }});
  const repository=createArkivEventRepository({publicTransport:transport as never});
  await assert.rejects(repository.scan({type:'message',scope}),{code:'HISTORY_INCOMPLETE'});assert.equal(queries,6);
});
