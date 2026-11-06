import { createPublicClient,createWalletClient,ExpirationTime } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { and,asc,eq,gt,startsWith } from '@arkiv-network/sdk/query';
import { addr,bool,bytes,i32,key,str,u64,type ArkivValue,type Schema } from '@arkiv-network/sdk/schema';
import type { FullEntity } from '@arkiv-network/sdk/query';
import { custom,http,hexToBytes,type Hex } from 'viem';
import type { StoreOptions,ArkivStore } from './contracts.ts';
import type { Backend,Kind,StoredEntity,Values,Value,Writer } from './backend.ts';
import { address,entityKey } from './codec.ts';
import { fail,mapError } from './errors.ts';
import { CHAIN_ID,DURABLE_LIFETIME_DAYS,Schemas,NAMESPACE } from './schema.ts';
import { createStorageService } from './service.ts';

function typed(field:string,value:Value):ArkivValue {
  if(field==='executionChainId'||field==='$expiresAt')return u64(value as bigint);
  if(['rootVersion','parentVersion','forkSource','community','strategyVersion','$key'].includes(field))return key(value as Hex);
  if(['tokenIn','tokenOut','$creator','$owner'].includes(field))return addr(value as Hex);
  if(typeof value==='string')return str(value);if(typeof value==='boolean')return bool(value);
  if(typeof value==='number')return i32(value);if(value instanceof Uint8Array)return bytes(value);
  return fail('INVALID_INPUT','Unknown attribute encoding');
}
export function encodeValues(values:Values):Record<string,ArkivValue>{return Object.fromEntries(Object.entries(values).map(([field,value])=>[field,typed(field,value)]));}
function decoded(raw:FullEntity):StoredEntity {
  const tag=raw.$attributes['arkiv.schema'];
  const kind=(Object.keys(Schemas) as Kind[]).find(k=>tag?.type==='str'&&tag.value===`${NAMESPACE}.${k}`);
  if(!kind)fail('UNTRUSTED_RECORD','Foreign namespace');
  const schema=Schemas[kind];const values:Values={};
  for(const [field,column]of Object.entries(schema.columns)){
    const value=raw.$attributes[field];
    if(!value){if(!column.isOptional)fail('INTEGRITY_FAILED','Missing required attribute');continue;}
    if(value.type!==column.type)fail('INTEGRITY_FAILED','Attribute type mismatch');
    values[field]=value.type==='bytes'?hexToBytes(value.value):value.type==='addr'?address(value.value):value.value;
  }
  return {kind,key:entityKey(raw.$key),creator:address(raw.$creator),owner:address(raw.$owner),createdAt:raw.$createdAt,
    expiresAt:raw.$expiresAt,readonly:raw.$creationFlags.readonly,permissionlessExtension:raw.$creationFlags.permissionlessExtension,values};
}
export function createSDKBackend(options:StoreOptions={}):Backend {
  const chain=rabdi({accessKey:options.accessKey??''});
  const publicClient=createPublicClient({chain,transport:options.publicTransport??http(typeof window === 'undefined' ? undefined : '/api/arkiv-rpc',{retryCount:0,timeout:10_000})});
  const safe=async<T>(operation:()=>Promise<T>,writing=false):Promise<T>=>{try{return await operation();}catch(e){throw mapError(e,writing);}};
  return {
    source:'arkiv',
    get:entity=>safe(async()=>decoded(await publicClient.getEntity(entity))),
    query:async(kind,filters,page)=>safe(async()=>{
      const conditions=[eq('arkiv.schema',`${NAMESPACE}.${kind}`),...filters.map(f=>{
        if(f.prefix)return startsWith(f.field,String(f.value));
        const value=typed(f.field,f.value);if(value.type==='bytes')fail('INVALID_INPUT','Cannot filter binary content');return eq(f.field,value);
      })];
      if(page.afterKey)conditions.push(gt('$key',key(page.afterKey)));
      const result=await publicClient.select().where(and(...conditions)).orderBy(asc('$key')).limit(page.limit).offset(page.offset).fetch();
      const entities:StoredEntity[]=[];let skipped=0;
      for(const raw of result.entities){try{entities.push(decoded(raw));}catch(e){if(e instanceof Error&&'code'in e&&['INTEGRITY_FAILED','UNTRUSTED_RECORD'].includes(String(e.code)))skipped++;else throw e;}}
      return {entities,skipped,rawCount:result.entities.length,blockNumber:result.blockNumber};
    }),
    currentBlock:()=>safe(async()=>{
      if(await publicClient.getChainId()!==CHAIN_ID)fail('WRONG_CHAIN');
      return BigInt((await publicClient.getBlockTiming()).currentBlock);
    }),
    writer:()=>safe(async():Promise<Writer>=>{
      if(!options.getWalletContext)fail('WALLET_REQUIRED');
      const context=await options.getWalletContext();const account=address(context.account);
      async function assertCurrent(){
        const latest=await options.getWalletContext!();
        if(address(latest.account)!==account||latest.provider!==context.provider)fail('ACCOUNT_CHANGED');
        const accounts=await context.provider.request({method:'eth_accounts'});
        if(!accounts[0]||address(accounts[0])!==account)fail('ACCOUNT_CHANGED');
        const current=await context.provider.request({method:'eth_chainId'});
        if(BigInt(current)!==BigInt(CHAIN_ID))fail('WRONG_CHAIN');
      }
      const current=await context.provider.request({method:'eth_chainId'});
      if(BigInt(current)!==BigInt(CHAIN_ID)){
        if(!context.requestRabdiSwitch)fail('WRONG_CHAIN');await context.requestRabdiSwitch();
      }
      await assertCurrent();
      let submissionStarted=false;
      const provider={request:((args:{method:string;params?:unknown})=>{
        if(['eth_sendTransaction','eth_sendRawTransaction','wallet_sendCalls'].includes(args.method))submissionStarted=true;
        return context.provider.request(args as never);
      }) as typeof context.provider.request};
      const client=createWalletClient({chain,account,transport:custom(provider,{retryCount:0})});
      const write=async<T>(operation:()=>Promise<T>):Promise<T>=>{
        submissionStarted=false;
        try{await assertCurrent();return await operation();}
        catch(error){throw mapError(error,submissionStarted);}
      };
      return {
        account,assertCurrent,
        create:(kind,values,readonly,durationDays)=>write(async()=>{
          const expiration = durationDays !== undefined
            ? (durationDays >= 182 ? ExpirationTime.max() : ExpirationTime.fromDays(durationDays))
            : ExpirationTime.fromDays(DURABLE_LIFETIME_DAYS);
          return client.createEntity(Schemas[kind] as Schema,encodeValues(values),{
            expiration,flags:{readonly,permissionlessExtension:kind === 'communities'},
          });
        }),
        patch:(entity,values)=>write(async()=>{return client.patchEntity(Schemas.communities,entity,{set:encodeValues(values)});}),
        extend:(entity,durationDays)=>write(async()=>{
          const expiration = durationDays !== undefined
            ? (durationDays >= 182 ? ExpirationTime.max() : ExpirationTime.fromDays(durationDays))
            : ExpirationTime.fromDays(DURABLE_LIFETIME_DAYS);
          return client.extendEntity({entityKey:entity,expiration});
        }),
        delete:entity=>write(async()=>{return client.deleteEntity({entityKey:entity});}),
      };
    }),
  };
}
export function createArkivStore(options:StoreOptions={}):ArkivStore{return createStorageService(createSDKBackend(options),options.validateStrategyDocument);}
