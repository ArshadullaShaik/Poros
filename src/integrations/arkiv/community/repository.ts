import {createPublicClient,createWalletClient,ExpirationTime} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {and,asc,eq,gt} from '@arkiv-network/sdk/query';
import type {FullEntity,Expression} from '@arkiv-network/sdk/query';
import {addr,bytes,defineSchema,key,str,type Schema} from '@arkiv-network/sdk/schema';
import {custom,http,hexToBytes,type Hex,type Account} from 'viem';
import type {StoreOptions} from '../contracts.ts';
import type {EventDTO,EventFilter,EventInput,EventRepository} from './contracts.ts';
import {address,canonical,entityKey,parseCanonicalRecord,recordBytes,requestId} from '../codec.ts';
import {fail,mapError,StorageError} from '../errors.ts';
import {buildEvent,checkedBlock,decodeEvent} from './events.ts';
import {CHAIN_ID,CHAT_LIFETIME_DAYS,DURABLE_LIFETIME_DAYS} from '../schema.ts';

export const SOCIAL_NAMESPACE='ethmumbai.social.v1.events';
export const socialLifetimeDays=(type:EventInput['type'])=>type==='message'?CHAT_LIFETIME_DAYS:DURABLE_LIFETIME_DAYS;
const schema:Schema=defineSchema(SOCIAL_NAMESPACE,{eventType:str().indexed(),subject:str().indexed(),scope:str().indexed(),requestId:str().indexed(),record:bytes()});
export function createArkivEventRepository(options:StoreOptions & {signer?:Account}={}):EventRepository {
  const chain=rabdi({accessKey:options.accessKey??''});
  const client=createPublicClient({chain,transport:options.publicTransport??http(typeof window === 'undefined' ? undefined : '/api/arkiv-rpc',{timeout:10000,retryCount:0})});
  const locks=new Set<Hex>();
  let pendingHead: Promise<bigint> | undefined;
  async function safe<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(e){throw mapError(e);}}
  function head() {
    if (!pendingHead) pendingHead = (async () => {
      if (await client.getChainId() !== CHAIN_ID) fail('WRONG_CHAIN');
      return BigInt((await client.getBlockTiming()).currentBlock);
    })().finally(() => { pendingHead = undefined; });
    return pendingHead;
  }
  function decode(raw:FullEntity):EventDTO {
    const attrs=raw.$attributes;
    if(Object.keys(attrs).sort().join(',')!=='arkiv.schema,eventType,record,requestId,scope,subject'||attrs['arkiv.schema']?.value!==SOCIAL_NAMESPACE||attrs.record?.type!=='bytes')fail('UNTRUSTED_RECORD');
    const record=decodeEvent(parseCanonicalRecord(hexToBytes(attrs.record.value)),raw.$creator,raw.$owner,raw.$creationFlags.readonly,raw.$creationFlags.permissionlessExtension);
    for(const [field,value]of Object.entries({eventType:record.type,subject:record.subject,scope:record.scope,requestId:record.requestId}))
      if(attrs[field]?.type!=='str'||attrs[field]?.value!==value)fail('INTEGRITY_FAILED');
    return {...record,key:entityKey(raw.$key.toLowerCase()),createdAtBlock:String(raw.$createdAt),expiresAtBlock:String(raw.$expiresAt),source:'arkiv'};
  }
  async function context(){if(!options.getWalletContext)fail('WALLET_REQUIRED');return options.getWalletContext();}
  const repository:EventRepository={source:'arkiv',
    actor:()=>safe(async()=>options.signer?address(options.signer.address):address((await context()).account)),
    read:key=>safe(async()=>decode(await client.getEntity(entityKey(key)))),
    scan:filter=>safe(async()=>{
      if(Object.keys(filter).some(k=>!['type','subject','scope','actor','requestId','afterBlock'].includes(k)))fail('INVALID_INPUT');
      const upper=await head();const lower=filter.afterBlock!==undefined?checkedBlock(filter.afterBlock):0n;
      const conditions:Expression[]=[eq('arkiv.schema',SOCIAL_NAMESPACE)];
      if(filter.type)conditions.push(eq('eventType',str(filter.type)));
      for(const field of ['subject','scope']as const)if(filter[field]!==undefined){if(!filter[field]||new TextEncoder().encode(filter[field]).length>128)fail('INVALID_INPUT');conditions.push(eq(field,str(filter[field])));}
      if(filter.actor)conditions.push(eq('$creator',addr(address(filter.actor))));
      if(filter.requestId)conditions.push(eq('requestId',str(requestId(filter.requestId))));
      const rows:EventDTO[]=[];let after:Hex|undefined;let scanned=0;
      for(let page=0;page<6;page++){
        const where=after?[...conditions,gt('$key',key(after))]:conditions;
        const found=await client.select().where(and(...where)).orderBy(asc('$key')).limit(100).fetch();
        if(found.entities.length&&after&&found.entities[0]!.$key<=after)fail('INTEGRITY_FAILED','Non-advancing event scan');
        scanned+=found.entities.length;if(scanned>500)fail('HISTORY_INCOMPLETE','Event scan exceeds 500 live records');
        for(const raw of found.entities){try{rows.push(decode(raw));}catch(error){
          // An outsider cannot poison a public feed; author-filtered state/recovery must remain fail closed.
          if(filter.actor||!(error instanceof StorageError)||!['INVALID_INPUT','INTEGRITY_FAILED','UNTRUSTED_RECORD','UNSUPPORTED_SCHEMA','PAYLOAD_TOO_LARGE'].includes(error.code))throw error;
        }}
        // SDK 1.0.1 forbids filtering $createdAt: scan bounded scope, then overlap/filter native blocks locally.
        if(found.entities.length<100)return rows.filter(row=>BigInt(row.createdAtBlock)>=lower&&BigInt(row.createdAtBlock)<=upper);
        after=found.entities.at(-1)!.$key;
      }return fail('HISTORY_INCOMPLETE');
    }),
    append:input=>safe(async()=>{
      const record=buildEvent(input);if(locks.has(record.actor))fail('WRITE_STATUS_UNKNOWN');locks.add(record.actor);
      try{
        const wallet=options.signer?undefined:await context();
        const account=address(options.signer?.address??wallet!.account);if(account!==record.actor)fail('ACCOUNT_CHANGED');
        async function guard(){
          if(options.signer){if(await client.getChainId()!==CHAIN_ID)fail('WRONG_CHAIN');return;}
          const latest=await context();if(address(latest.account)!==account||latest.provider!==wallet!.provider)fail('ACCOUNT_CHANGED');
          const accounts=await wallet!.provider.request({method:'eth_accounts'});if(!accounts[0]||address(accounts[0])!==account)fail('ACCOUNT_CHANGED');
          if(BigInt(await wallet!.provider.request({method:'eth_chainId'}))!==BigInt(CHAIN_ID))fail('WRONG_CHAIN');
        }
        if(wallet&&BigInt(await wallet.provider.request({method:'eth_chainId'}))!==BigInt(CHAIN_ID)){if(!wallet.requestRabdiSwitch)fail('WRONG_CHAIN');await wallet.requestRabdiSwitch();}
        await guard();const prior=await repository.scan({actor:account,requestId:record.requestId});
        if(prior.length>1)fail('DUPLICATE_REQUEST');if(prior[0]){if(prior[0].hash!==record.hash)fail('IDEMPOTENCY_CONFLICT');return prior[0];}
        const writer=options.signer?createWalletClient({chain,account:options.signer,transport:options.publicTransport??http()}):createWalletClient({chain,account,transport:custom(wallet!.provider,{retryCount:0})});await guard();
        let result;
        try{result=await writer.createEntity(schema,{eventType:str(record.type),subject:str(record.subject),scope:str(record.scope),requestId:str(record.requestId),record:bytes(recordBytes(record))},
          {expiration:ExpirationTime.fromDays(socialLifetimeDays(record.type)),flags:{readonly:true,permissionlessExtension:false}});}catch(e){const error=mapError(e,true);error.requestId=record.requestId;throw error;}
        try{const read=await repository.read(result.entityKey);if(read.hash!==record.hash||canonical(read.data)!==canonical(record.data))fail('INTEGRITY_FAILED');return {...read,txHash:result.txHash};}
        catch{throw new StorageError('WRITE_CONFIRMED_READ_PENDING',undefined,{requestId:record.requestId,txHash:result.txHash,entityKey:result.entityKey,included:true});}
      }finally{locks.delete(record.actor);}
    }),
  };
  const scan = repository.scan;
  const pendingScans = new Map<string, Promise<EventDTO[]>>();
  repository.scan = filter => {
    const key = canonical(filter);
    let pending = pendingScans.get(key);
    if (!pending) {
      pending = scan(filter).finally(() => { pendingScans.delete(key); });
      pendingScans.set(key,pending);
    }
    return pending.then(rows => structuredClone(rows));
  };
  return repository;
}
