import test from 'node:test';
import assert from 'node:assert/strict';
import { createArkivStore, createSDKBackend } from '../../../src/integrations/arkiv/client.ts';
import { alice,fixture,validator,request } from './fixtures.ts';
import { buildVersion,versionValues } from '../../../src/integrations/arkiv/records.ts';
import { parseDocument } from '../../../src/integrations/arkiv/codec.ts';
const transport=(handler:(method:string,params:unknown[])=>unknown)=>()=>({
  config:{key:'test',name:'test',type:'custom',retryCount:0,retryDelay:0,timeout:1000},
  request:async({method,params=[]}:{method:string;params?:unknown[]})=>handler(method,params),value:undefined,
});
test('real SDK query encodes namespace, typed chain filter and key pagination',async()=>{
  const calls:{method:string;params:unknown[]}[]=[];
  const store=createArkivStore({publicTransport:transport((method,params)=>{
    calls.push({method,params});if(method==='arkiv_query')return {data:[],blockNumber:'0x64'};throw new Error(method);
  }) as never});
  const result=await store.listStrategies({creator:alice,executionChainId:1,page:{limit:3,offset:6}});
  assert.equal(result.source,'arkiv');assert.equal(result.blockNumber,'100');
  assert.equal(calls.length,1);assert.equal(calls[0]?.method,'arkiv_query');
  const query=String(calls[0]?.params[0]);
  assert.match(query,/arkiv\.schema = str\('ethmumbai\.strategyhub\.v1\.versions'\)/);
  assert.match(query,/executionChainId = u64\(1\)/);assert.match(query,/ORDER BY \$key(?::key)? ASC/);
  assert.equal((calls[0]?.params[1] as {limit:string}).limit,'0x3');
  assert.equal((calls[0]?.params[1] as {offset:string}).offset,'0x6');
});
test('production writes fail closed without wallet and never use a service signer',async()=>{
  const store=createArkivStore({validateStrategyDocument:validator});
  await assert.rejects(store.publishStrategy({requestId:request,document:fixture}),{code:'WALLET_REQUIRED'});
});
test('provider account/chain is rechecked and switch failure does not sign',async()=>{
  let sent=0;
  const provider={request:async({method}:{method:string})=>{
    if(method==='eth_accounts')return [alice];if(method==='eth_chainId')return '0x1';sent++;throw new Error('must not sign');
  }};
  const backend=createSDKBackend({getWalletContext:async()=>({account:alice,provider:provider as never})});
  await assert.rejects(backend.writer(),{code:'WRONG_CHAIN'});assert.equal(sent,0);
});
test('SDK read failures are sanitized and never appear as an empty successful list',async()=>{
  const store=createArkivStore({publicTransport:transport(()=>{throw new Error('secret RPC /do-not-print-this-key');}) as never});
  await assert.rejects(store.listStrategies(),(e:unknown)=>{
    const error=e as Error&{code:string};assert.equal(error.code,'NETWORK_UNAVAILABLE');assert.doesNotMatch(error.message,/secret|key/);return true;
  });
});
test('nonempty raw RPC entity decodes through the actual SDK into a verified public version',async()=>{
  const record=buildVersion(alice,request,parseDocument(fixture,validator));
  const values=versionValues(record),key=`0x${'1'.repeat(64)}` as const;
  const attributes=[{name:'arkiv.schema',type:'str',value:'ethmumbai.strategyhub.v1.versions'},...Object.entries(values).map(([name,value])=>({name,
    type:name==='record'?'bytes':name==='executionChainId'?'u64':name==='schemaVersion'?'i32':name==='isRoot'?'bool':name.startsWith('token')?'addr':'str',
    value:value instanceof Uint8Array?`0x${Buffer.from(value).toString('hex')}`:typeof value==='bigint'?`0x${value.toString(16)}`:value,
  }))];
  const raw={key,creator:alice,owner:alice,createdAt:'0x64',updatedAt:'0x64',expiresAt:'0x100000',
    creationFlags:{readonly:true,permissionlessExtension:false,raw:'0x1'},attributes};
  const store=createArkivStore({validateStrategyDocument:validator,publicTransport:transport(method=>{
    if(method==='arkiv_getEntity')return raw;
    if(method==='arkiv_query')return {data:[raw],blockNumber:'0x65'};
    throw new Error(method);
  }) as never});
  const result=await store.getVersion({versionKey:key});
  assert.equal(result.document.name,'Hold');assert.equal(result.contentHash,record.contentHash);assert.equal(result.lineageStatus,'verified');assert.equal(result.source,'arkiv');
  assert.equal((await store.listStrategies()).items[0]?.rootVersionKey,key);
});

test('wallet read failure before submission does not leave an uncertain write',async()=>{
  let failRead=false;
  const provider={request:async({method}:{method:string})=>{
    if(failRead)throw new Error('wallet disconnected');
    if(method==='eth_accounts')return [alice];
    if(method==='eth_chainId')return '0x76edaf';
    throw new Error(method);
  }};
  const backend=createSDKBackend({getWalletContext:async()=>({account:alice,provider:provider as never})});
  const writer=await backend.writer();
  failRead=true;
  await assert.rejects(writer.delete(`0x${'1'.repeat(64)}`),{code:'NETWORK_UNAVAILABLE'});
});

for(const stage of ['estimate','submit','reject'] as const)test(`SDK ${stage} failure keeps the correct submission status`,async()=>{
  let sends=0;
  const provider={request:async({method}:{method:string})=>{
    if(method==='eth_accounts')return [alice];
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='eth_estimateGas'){
      if(stage==='estimate')throw new Error('network disconnected');
      return '0x100000';
    }
    if(method==='eth_sendTransaction'){
      sends++;
      if(stage==='reject')throw Object.assign(new Error('User rejected'),{code:4001});
      throw new Error('connection lost');
    }
    throw new Error(`unexpected ${method}`);
  }};
  const writer=await createSDKBackend({getWalletContext:async()=>({account:alice,provider:provider as never})}).writer();
  await assert.rejects(writer.delete(`0x${'1'.repeat(64)}`),{code:stage==='estimate'?'NETWORK_UNAVAILABLE':stage==='reject'?'USER_REJECTED':'WRITE_STATUS_UNKNOWN'});
  assert.equal(sends,stage==='estimate'?0:1);
});
