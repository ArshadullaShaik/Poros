import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {createArkivEventRepository} from '../../../src/integrations/arkiv/community/repository.ts';
test('the real SDK local signer stops before broadcast when durable signature persistence fails',async()=>{
 const account=privateKeyToAccount(('0x'+'1'.repeat(64)) as `0x${string}`);let signed=false,broadcast=false;
 const signer={...account,async signTransaction(...args:Parameters<typeof account.signTransaction>){await account.signTransaction(...args);signed=true;throw Error('Cannot persist signed transaction');}};
 const seen:string[]=[];
 const transport=()=>({config:{key:'fixture',name:'fixture',type:'custom',retryCount:0,retryDelay:0,timeout:1000},request:async({method}:{method:string})=>{
  seen.push(method);
  if(method==='eth_chainId')return '0x76edaf';
  if(method==='arkiv_getBlockTiming')return {current_block:'0x64',current_block_time:1,duration:2};
  if(method==='arkiv_query')return {data:[],blockNumber:'0x64'};
  if(method==='eth_blockNumber')return '0x64';
  if(method==='eth_estimateGas')return '0x100000';
  if(method==='eth_getTransactionCount')return '0x0';
  if(method==='eth_maxPriorityFeePerGas'||method==='eth_gasPrice')return '0x10';
  if(method==='eth_getBlockByNumber')return {number:'0x64',hash:'0x'+'1'.repeat(64),timestamp:'0x64',baseFeePerGas:'0x10',gasLimit:'0x10000000',gasUsed:'0x0',transactions:[]};
  if(method==='eth_sendRawTransaction'){broadcast=true;throw Error('Unexpected broadcast');}
  throw Error(method);
 }});
 const events=createArkivEventRepository({signer,publicTransport:transport as any});
 await assert.rejects(events.append({actor:account.address.toLowerCase() as `0x${string}`,type:'creator-plan',subject:account.address.toLowerCase(),scope:'global',requestId:crypto.randomUUID(),data:{priceWei:'1',termDays:30,chainId:7794095}}));
 assert.equal(signed,true,seen.join(','));assert.equal(broadcast,false);
});
