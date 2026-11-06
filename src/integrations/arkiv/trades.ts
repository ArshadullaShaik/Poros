import {createPublicClient,createWalletClient,ExpirationTime} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {and,asc,eq,gt} from '@arkiv-network/sdk/query';
import type {Expression} from '@arkiv-network/sdk/query';
import {addr,bytes,defineSchema,key,str} from '@arkiv-network/sdk/schema';
import {http,hexToBytes,type Account,type Hex,type Transport} from 'viem';
import {address,canonical,parseCanonicalRecord,recordBytes} from './codec.ts';
import {buildTradeRecord} from './trade-contracts.ts';
import type {LedgerInput,LedgerEntry} from './trade-contracts.ts';
export * from './trade-contracts.ts';
const namespace='ethmumbai.trades.v1';
const schema=defineSchema(namespace,{recordKind:str().indexed(),trader:addr().indexed(),source:str().indexed(),identity:str().indexed(),record:bytes()});
export interface TradeRepository {
 append(input:LedgerInput):Promise<LedgerEntry>;
 find(identity:Hex):Promise<LedgerEntry[]>;
 list(args:{trader?:Hex;afterKey?:Hex;limit?:number}):Promise<{items:LedgerEntry[];nextKey?:Hex}>;
 renew(entityKey:Hex):Promise<LedgerEntry>;
 read(entityKey:Hex):Promise<LedgerEntry>;
 due?():Promise<LedgerEntry[]>;
 ready?():Promise<void>;
}
export function decodeTradeEntity(raw:any,trustedWriter:string,currentBlock=0n):LedgerEntry {
 const trusted=address(trustedWriter);
 if(address(raw.$creator)!==trusted||address(raw.$owner)!==trusted||raw.$creationFlags?.readonly!==true||raw.$creationFlags.permissionlessExtension!==false)throw new Error('Untrusted trade writer');
 const a=raw.$attributes;
 if(!a||Object.keys(a).sort().join(',')!=='arkiv.schema,identity,record,recordKind,source,trader'||a['arkiv.schema']?.value!==namespace||a.record?.type!=='bytes')throw new Error('Invalid trade schema');
 const parsed=parseCanonicalRecord(hexToBytes(a.record.value));
 const {identity,recordHash,...input}=parsed;
 const record=buildTradeRecord(input as LedgerInput);
 if(record.identity!==identity||record.recordHash!==recordHash||canonical(record)!==canonical(parsed))throw new Error('Invalid trade evidence hash');
 for(const [k,v]of Object.entries({recordKind:record.kind,trader:record.trader,source:record.source.sourceId,identity:record.identity}))if(a[k]?.value!==v||a[k].type!==(k==='trader'?'addr':'str'))throw new Error('Trade index mismatch');
 if(!/^0x[0-9a-f]{64}$/.test(raw.$key)||BigInt(raw.$expiresAt)<=currentBlock)throw new Error('Invalid or expired trade entity');
 return {...record,entityKey:raw.$key,expiresAtBlock:String(raw.$expiresAt)};
}
export function createTradeRepository({accessKey='',trustedWriter,signer,publicTransport}:{accessKey?:string;trustedWriter:Hex;signer?:Account;publicTransport?:Transport}):TradeRepository {
 const chain=rabdi({accessKey}),transport=publicTransport??http(undefined,{timeout:15000,retryCount:0});
 const client=createPublicClient({chain,transport});
 const trusted=address(trustedWriter);
 const writer=signer?createWalletClient({chain,account:signer,transport}):undefined;
 async function guard(){if(!writer||!signer||address(signer.address)!==trusted)throw new Error('ARKIV_WRITER_NOT_CONFIGURED');if(await client.getChainId()!==7794095)throw new Error('Wrong Arkiv chain');}
 async function read(entity:Hex){const [raw,timing]=await Promise.all([client.getEntity(entity),client.getBlockTiming()]);return decodeTradeEntity(raw,trusted,timing.currentBlock);}
 async function query(filter:{trader?:Hex;afterKey?:Hex;limit?:number;identity?:Hex}){
  const limit=filter.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('Invalid ledger page');
  const where:Expression[]=[eq('arkiv.schema',namespace),eq('$creator',addr(trusted))];
  if(filter.trader)where.push(eq('trader',addr(address(filter.trader))));
  if(filter.identity)where.push(eq('identity',str(filter.identity)));
  if(filter.afterKey)where.push(gt('$key',key(filter.afterKey)));
  const found=await client.select().where(and(...where)).orderBy(asc('$key')).limit(limit).fetch();
  const timing=await client.getBlockTiming();
  const items=found.entities.map(raw=>decodeTradeEntity(raw,trusted,timing.currentBlock));
  if(filter.afterKey&&items[0]&&items[0].entityKey<=filter.afterKey)throw new Error('Non-advancing ledger page');
  return {items,...items.length===limit?{nextKey:items.at(-1)!.entityKey}:{}};
 }
 return {read,list:query,find:async identity=>(await query({identity})).items,
  async ready(){await guard();if(await client.getBalance({address:trusted})<=0n)throw new Error('Arkiv writer needs tGLM');},
  async due(){const timing=await client.getBlockTiming();if(!Number.isFinite(timing.blockDuration)||timing.blockDuration<=0)throw new Error('Invalid Arkiv block duration');const before=timing.currentBlock+BigInt(Math.ceil(30*86400/timing.blockDuration));const entries:LedgerEntry[]=[];let afterKey:Hex|undefined;
   do{const page=await query({afterKey});entries.push(...page.items.filter(e=>BigInt(e.expiresAtBlock)<before));afterKey=page.nextKey;}while(afterKey);return entries;
  },
  async append(input){
   await guard();const record=buildTradeRecord(input),prior=await query({identity:record.identity});
   if(prior.items.length){if(prior.items.some(r=>r.recordHash!==record.recordHash))throw new Error('LEDGER_CONFLICT');return prior.items[0]!;}
   const result=await writer!.createEntity(schema,{recordKind:str(record.kind),trader:addr(record.trader as Hex),source:str(record.source.sourceId),identity:str(record.identity),record:bytes(recordBytes(record))},{expiration:ExpirationTime.fromDays(180),flags:{readonly:true,permissionlessExtension:false}});
   const stored=await read(result.entityKey);if(stored.recordHash!==record.recordHash)throw new Error('Trade read-back mismatch');return {...stored,txHash:result.txHash};
  },
  async renew(entityKey){await guard();const prior=await read(entityKey);const result=await writer!.extendEntity({entityKey,expiration:ExpirationTime.fromDays(180)});const entry=await read(entityKey);if(BigInt(entry.expiresAtBlock)<=BigInt(prior.expiresAtBlock))throw new Error('Renewal not verified');return {...entry,txHash:result.txHash};},
 };
}
