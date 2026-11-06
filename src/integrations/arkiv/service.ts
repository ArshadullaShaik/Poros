import type { Hex } from 'viem';
import type { Backend, Filter, Inclusion, Kind, StoredEntity, Values, Writer } from './backend.ts';
import type { ArkivStore, CommunityDTO, CreateResult, Page, PageInput, PostDTO, StrategySummaryDTO, ValidateStrategyDocument, VersionDTO, VersionRecord, WriteReceipt } from './contracts.ts';
import { address, canonical, entityKey, exactKeys, name, parseDocument, requestId, searchName, text } from './codec.ts';
import { fail, mapError, StorageError } from './errors.ts';
import { assertNative, buildCommunity, buildPost, buildVersion, communityValues, decodeCommunity, decodePost, decodeVersion, postValues, sameValues, versionValues } from './records.ts';

function input(value: unknown, required: string[], optional: string[]=[]): void {
  if(!value || typeof value!=='object' || Array.isArray(value)) fail('INVALID_INPUT');
  exactKeys(value as Record<string,unknown>,required,optional);
}
function page(value: PageInput={}): {offset:number;limit:number} {
  input(value,[],['offset','limit']);const offset=value.offset??0,limit=value.limit??20;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100) fail('INVALID_INPUT','Invalid page');
  return {offset,limit};
}
const kinds: Kind[]=['versions','communities','posts'];
export function createStorageService(backend: Backend, validator?: ValidateStrategyDocument): ArkivStore {
  const locks=new Set<Hex>();
  async function write<T>(operation:(writer:Writer)=>Promise<T>):Promise<T> {
    const writer=await backend.writer();
    if(locks.has(writer.account)) fail('WRITE_STATUS_UNKNOWN','Another write is pending for this account');
    locks.add(writer.account);
    try { await writer.assertCurrent(); return await operation(writer); }
    catch(e){throw mapError(e,true);} finally {locks.delete(writer.account);}
  }
  async function matches(creator:Hex,request:string) {
    const rows:StoredEntity[]=[];
    for(const kind of kinds) {
      const result=await backend.query(kind,[{field:'$creator',value:creator},{field:'requestId',value:request}],{offset:0,limit:2});
      if(result.skipped) fail('UNTRUSTED_RECORD','Malformed request matches');
      rows.push(...result.entities);
    }
    return rows;
  }
  async function recoverVersion(creator:Hex,request:string,intent:{document:unknown;rootVersionKey?:Hex;parentVersionKey?:Hex;forkSourceVersionKey?:Hex;communityKey?:Hex}):Promise<CreateResult<VersionDTO>|undefined> {
    const found=await matches(creator,request);
    if(found.length>1) fail('DUPLICATE_REQUEST');
    if(!found.length) return;
    const e=found[0]!;
    if(e.kind!=='versions') fail('IDEMPOTENCY_CONFLICT');
    const r=decodeVersion(e,validator);
    if(canonical(r.document)!==canonical(intent.document)||r.rootVersionKey!==intent.rootVersionKey||r.parentVersionKey!==intent.parentVersionKey||
      r.forkSourceVersionKey!==intent.forkSourceVersionKey || (!intent.rootVersionKey && r.communityKey!==intent.communityKey)) fail('IDEMPOTENCY_CONFLICT');
    return {state:'recovered',value:await versionDTO(e),entityKey:e.key,source:backend.source,readBackVerified:true};
  }
  async function unavailableOnly(operation:()=>Promise<void>):Promise<boolean> {
    try{await operation();return false;}catch(e){if(e instanceof StorageError&&e.code==='NOT_FOUND_OR_EXPIRED')return true;throw e;}
  }
  async function loadVersion(key:Hex,seen:Set<Hex>,cache:Map<Hex,VersionDTO>):Promise<VersionDTO>{
    if(seen.has(key))fail('INTEGRITY_FAILED','Cyclic lineage');
    return cache.get(key)??versionDTO(await backend.get(key),seen,cache);
  }
  async function versionDTO(e:StoredEntity,seen=new Set<Hex>(),cache=new Map<Hex,VersionDTO>()):Promise<VersionDTO> {
    if(seen.has(e.key)||seen.size>=200) fail('INTEGRITY_FAILED','Cyclic or too deep lineage');
    const path=new Set(seen);path.add(e.key);
    const r=decodeVersion(e,validator); let lineageStatus:'verified'|'missing-ancestor'='verified';
    if(r.parentVersionKey) {
      const rootMissing=await unavailableOnly(async()=>{
        const rr=await loadVersion(r.rootVersionKey!,path,cache);
        if(rr.rootVersionKey||rr.creator!==r.creator||rr.strategyId!==r.strategyId||rr.communityKey!==r.communityKey||BigInt(rr.createdAtBlock)>=e.createdAt)fail('INTEGRITY_FAILED','Invalid root relationship');
      });
      if(rootMissing)lineageStatus='missing-ancestor';
      const missing=await unavailableOnly(async()=>{
        const parent=await loadVersion(r.parentVersionKey!,path,cache);
        if(parent.creator!==r.creator||parent.strategyId!==r.strategyId||BigInt(parent.createdAtBlock)>=e.createdAt||
          (parent.rootVersionKey??parent.versionKey)!==r.rootVersionKey||parent.communityKey!==r.communityKey) fail('INTEGRITY_FAILED','Invalid parent relationship');
        if(parent.lineageStatus!=='verified')lineageStatus='missing-ancestor';
      });
      if(missing)lineageStatus='missing-ancestor';
    }
    if(r.forkSourceVersionKey) {
      const missing=await unavailableOnly(async()=>{const source=await loadVersion(r.forkSourceVersionKey!,path,cache);
        if(source.contentHash!==r.forkSourceContentHash)fail('INTEGRITY_FAILED','Fork source hash differs');
        if(source.lineageStatus!=='verified')lineageStatus='missing-ancestor';});
      if(missing)lineageStatus='missing-ancestor';
    }
    let communityStatus:'none'|'live'|'unavailable'='none';
    if(r.communityKey) communityStatus=await unavailableOnly(async()=>{await store.getCommunity({communityKey:r.communityKey!});})?'unavailable':'live';
    const result:VersionDTO={...r,versionKey:e.key,creator:address(e.creator),owner:address(e.owner),createdAtBlock:String(e.createdAt),
      expiresAtBlock:String(e.expiresAt),source:backend.source,lineageStatus,communityStatus};
    cache.set(e.key,result);return result;
  }
  async function includedVersion(writer:Writer,r:VersionRecord):Promise<CreateResult<VersionDTO>> {
    const values=versionValues(r);await writer.assertCurrent();
    const included=await writer.create('versions',values,true);
    try {
      const value=await versionDTO(await backend.get(included.entityKey));
      if(value.recordHash!==r.recordHash)fail('INTEGRITY_FAILED');
      return {state:'written',receipt:{value,entityKey:included.entityKey,txHash:included.txHash,
        expiresAtBlock:value.expiresAtBlock,source:backend.source,readBackVerified:true}};
    }catch{throw new StorageError('WRITE_CONFIRMED_READ_PENDING','Included; read-back not verified',
      {included:true,entityKey:included.entityKey,txHash:included.txHash,requestId:r.requestId,retryable:true});}
  }
  async function listing<T>(kind:Kind,filters:Filter[],p:PageInput|undefined,decode:(e:StoredEntity)=>Promise<T>):Promise<Page<T>> {
    const window=page(p);const result=await backend.query(kind,filters,window);const items:T[]=[];let skipped=result.skipped;
    for(const e of result.entities) {
      try {items.push(await decode(e));}catch(error){
        if(error instanceof StorageError&&['INTEGRITY_FAILED','UNTRUSTED_RECORD','UNSUPPORTED_SCHEMA','PAYLOAD_TOO_LARGE'].includes(error.code))skipped++;else throw error;
      }
    }
    return {items,...window,nextOffset:result.rawCount===window.limit?window.offset+window.limit:null,
      blockNumber:String(result.blockNumber),skipped,source:backend.source};
  }
  async function communityDTO(e:StoredEntity):Promise<CommunityDTO>{const r=decodeCommunity(e);
    return {communityKey:e.key,creator:r.creator,owner:address(e.owner),name:r.name,description:r.description,
      contentHash:r.contentHash,expiresAtBlock:String(e.expiresAt),source:backend.source};}
  async function postDTO(e:StoredEntity):Promise<PostDTO>{const r=decodePost(e);
    return {postKey:e.key,communityKey:r.communityKey,...(r.strategyVersionKey?{strategyVersionKey:r.strategyVersionKey}:{}),creator:r.creator,
      body:r.body,recordHash:r.recordHash,createdAtBlock:String(e.createdAt),expiresAtBlock:String(e.expiresAt),source:backend.source};}
  async function receipt<T>(included:Inclusion,expected:Values,decode:(e:StoredEntity)=>Promise<T>):Promise<WriteReceipt<T>>{
    try{const e=await backend.get(included.entityKey);const value=await decode(e);
      if(!sameValues(e.values,expected))throw new StorageError('CONCURRENT_UPDATE','Another update replaced the requested state',{included:true,entityKey:e.key,txHash:included.txHash});
      return {value,txHash:included.txHash,entityKey:e.key,expiresAtBlock:String(e.expiresAt),source:backend.source,readBackVerified:true};
    }catch(error){if(error instanceof StorageError&&error.code==='CONCURRENT_UPDATE')throw error;
      throw new StorageError('WRITE_CONFIRMED_READ_PENDING','Included; read-back not verified',{included:true,entityKey:included.entityKey,txHash:included.txHash,retryable:true});}
  }
  async function createMetadata<T>(writer:Writer,kind:Kind,values:Values,decode:(e:StoredEntity)=>Promise<T>,durationDays?:number):Promise<CreateResult<T>>{
    const found=await matches(writer.account,String(values.requestId));if(found.length>1)fail('DUPLICATE_REQUEST');
    if(found.length){const e=found[0]!;if(e.kind!==kind)fail('IDEMPOTENCY_CONFLICT');const value=await decode(e);
      if(!sameValues(e.values,values))fail('IDEMPOTENCY_CONFLICT');return {state:'recovered',value,entityKey:e.key,source:backend.source,readBackVerified:true};}
    await writer.assertCurrent();return {state:'written',receipt:await receipt(await writer.create(kind,values,kind!=='communities',durationDays),values,decode)};
  }
  const store:ArkivStore={
    async listStrategies(options={}) {
      input(options,[],['creator','category','executionChainId','communityKey','namePrefix','page']);
      const filters:Filter[]=[{field:'isRoot',value:true}];
      if(options.creator!==undefined)filters.push({field:'$creator',value:address(options.creator)});
      if(options.category){if(!['dca','rebalance','signal','other'].includes(options.category))fail('INVALID_INPUT');filters.push({field:'category',value:options.category});}
      if(options.executionChainId!==undefined){if(!Number.isSafeInteger(options.executionChainId)||options.executionChainId<1)fail('INVALID_INPUT');filters.push({field:'executionChainId',value:BigInt(options.executionChainId)});}
      if(options.communityKey!==undefined)filters.push({field:'community',value:entityKey(options.communityKey)});
      if(options.namePrefix!==undefined)filters.push({field:'nameSearch',value:searchName(text(options.namePrefix,1,128)),prefix:true});
      return listing('versions',filters,options.page,async e=>{
        const v=await versionDTO(e);if(v.rootVersionKey)fail('INTEGRITY_FAILED');
        const s:StrategySummaryDTO={strategyId:v.strategyId,rootVersionKey:v.versionKey,creator:v.creator,name:v.document.name,
          category:v.document.category,executionChainId:v.document.executionChainId,tokenIn:v.document.tokenIn,tokenOut:v.document.tokenOut,
          expiresAtBlock:v.expiresAtBlock,source:backend.source};
        if(v.communityKey)s.communityKey=v.communityKey;if(v.forkSourceVersionKey)s.forkSourceVersionKey=v.forkSourceVersionKey;return s;
      });
    },
    async getVersion(args){input(args,['versionKey']);return versionDTO(await backend.get(entityKey(args.versionKey)));},
    async listVersions(args) {
      input(args,['rootVersionKey'],['page']);const root=await store.getVersion({versionKey:entityKey(args.rootVersionKey)});
      if(root.rootVersionKey)fail('INVALID_INPUT','Expected a root version');
      const all:VersionDTO[]=[];const cache=new Map<Hex,VersionDTO>([[root.versionKey,root]]);let complete=true;let afterKey:Hex|undefined;
      try {
        for(;;){const result=await backend.query('versions',[{field:'$creator',value:root.creator},{field:'strategyId',value:root.strategyId}],{offset:0,limit:100,...(afterKey?{afterKey}:{})});
          if(result.skipped){complete=false;break;}
          for(const e of result.entities){if(all.length===200){complete=false;break;}const v=await versionDTO(e,new Set(),cache);if(v.lineageStatus!=='verified')complete=false;all.push(v);}
          if(!complete||result.rawCount<100)break;
          afterKey=result.entities.at(-1)?.key;if(!afterKey){complete=false;break;}
        }
      }catch(e){if(e instanceof StorageError&&['NETWORK_UNAVAILABLE','RATE_LIMITED','NOT_FOUND_OR_EXPIRED'].includes(e.code))complete=false;else throw e;}
      all.sort((a,b)=>BigInt(a.createdAtBlock)<BigInt(b.createdAtBlock)?-1:BigInt(a.createdAtBlock)>BigInt(b.createdAtBlock)?1:a.versionKey.localeCompare(b.versionKey));
      const parents=new Set(all.flatMap(v=>v.parentVersionKey?[v.parentVersionKey]:[]));const window=page(args.page);
      return {versions:all.slice(window.offset,window.offset+window.limit),tipVersionKeys:complete?all.filter(v=>!parents.has(v.versionKey)).map(v=>v.versionKey):[],
        complete,nextOffset:window.offset+window.limit<all.length?window.offset+window.limit:null,source:backend.source};
    },
    async publishStrategy(args) {
      input(args,['requestId','document'],['communityKey']);const request=requestId(args.requestId),document=parseDocument(args.document,validator);
      const communityKey=args.communityKey!==undefined?entityKey(args.communityKey):undefined;
      return write(async writer=>{
        const intent={document,...(communityKey?{communityKey}:{})};const recovered=await recoverVersion(writer.account,request,intent);if(recovered)return recovered;
        if(communityKey)await store.getCommunity({communityKey});
        return includedVersion(writer,buildVersion(writer.account,request,document,communityKey?{communityKey}:{}));
      });
    },
    async publishVersion(args) {
      input(args,['requestId','rootVersionKey','expectedParentVersionKey','document']);
      const request=requestId(args.requestId),rootKey=entityKey(args.rootVersionKey),parentKey=entityKey(args.expectedParentVersionKey),document=parseDocument(args.document,validator);
      return write(async writer=>{
        const recovered=await recoverVersion(writer.account,request,{document,rootVersionKey:rootKey,parentVersionKey:parentKey});if(recovered)return recovered;
        const root=await store.getVersion({versionKey:rootKey});if(root.creator!==writer.account)fail('NOT_OWNER');if(root.rootVersionKey)fail('INVALID_INPUT');
        const history=await store.listVersions({rootVersionKey:rootKey});if(!history.complete)fail('HISTORY_INCOMPLETE');
        if(history.tipVersionKeys.length!==1)fail('MULTIPLE_TIPS');if(history.tipVersionKeys[0]!==parentKey)fail('STALE_PARENT');
        return includedVersion(writer,buildVersion(writer.account,request,document,{strategyId:root.strategyId,rootVersionKey:rootKey,parentVersionKey:parentKey,...(root.communityKey?{communityKey:root.communityKey}:{})}));
      });
    },
    async forkVersion(args) {
      input(args,['requestId','sourceVersionKey','document'],['communityKey']);const request=requestId(args.requestId),sourceKey=entityKey(args.sourceVersionKey),document=parseDocument(args.document,validator);
      const communityKey=args.communityKey!==undefined?entityKey(args.communityKey):undefined;
      return write(async writer=>{
        const recovered=await recoverVersion(writer.account,request,{document,forkSourceVersionKey:sourceKey,...(communityKey?{communityKey}:{})});if(recovered)return recovered;
        const source=await store.getVersion({versionKey:sourceKey});if(communityKey)await store.getCommunity({communityKey});
        return includedVersion(writer,buildVersion(writer.account,request,document,{forkSourceVersionKey:sourceKey,forkSourceContentHash:source.contentHash,...(communityKey?{communityKey}:{})}));
      });
    },
    async reconcileRequest(args){input(args,['creator','requestId']);const found=await matches(address(args.creator),requestId(args.requestId));
      return {state:found.length>1?'duplicates':found.length===1?'one':'absent',entityKeys:found.map(e=>e.key),source:backend.source};},
    async listCommunities(args={}){input(args,[],['creator','page']);return listing('communities',args.creator!==undefined?[{field:'$creator',value:address(args.creator)}]:[],args.page,communityDTO);},
    async getCommunity(args){input(args,['communityKey']);return communityDTO(await backend.get(entityKey(args.communityKey)));},
    async createCommunity(args){input(args,['requestId','name','description'],['durationDays']);const request=requestId(args.requestId),title=name(args.name),description=text(args.description,0,4096);
      const durationDays = typeof args.durationDays === 'number' && args.durationDays > 0 ? args.durationDays : undefined;
      return write(writer=>createMetadata(writer,'communities',communityValues(buildCommunity(writer.account,request,title,description)),communityDTO,durationDays));},
    async updateCommunity(args){input(args,['communityKey','name','description']);const key=entityKey(args.communityKey),title=name(args.name),description=text(args.description,0,4096);
      return write(async writer=>{const e=await backend.get(key);const r=decodeCommunity(e);if(address(e.owner)!==writer.account)fail('NOT_OWNER');
        const values=communityValues(buildCommunity(writer.account,r.requestId,title,description));await writer.assertCurrent();return receipt(await writer.patch(key,values),values,communityDTO);});},
    async listPosts(args){input(args,['communityKey'],['page']);return listing('posts',[{field:'community',value:entityKey(args.communityKey)}],args.page,postDTO);},
    async createPost(args){input(args,['requestId','communityKey','body'],['strategyVersionKey']);const request=requestId(args.requestId),communityKey=entityKey(args.communityKey),body=text(args.body,1,2000),
      versionKey=args.strategyVersionKey!==undefined?entityKey(args.strategyVersionKey):undefined;
      return write(async writer=>{const values=postValues(buildPost(writer.account,request,communityKey,body,versionKey));
        const found=await matches(writer.account,request);
        if(!found.length){await store.getCommunity({communityKey});if(versionKey)await store.getVersion({versionKey});}
        return createMetadata(writer,'posts',values,postDTO);});},
    async extendOwnedEntity(args){input(args,['entityKey'],['durationDays']);const key=entityKey(args.entityKey);
      return write(async writer=>{const e=await backend.get(key);if(e.kind !== 'communities' && address(e.owner)!==writer.account)fail('NOT_OWNER');assertNative(e,e.kind!=='communities',e.kind==='communities');
        const durationDays = typeof args.durationDays === 'number' && args.durationDays > 0 ? args.durationDays : undefined;
        const current=await backend.currentBlock();if(!durationDays && e.expiresAt-current>=302_400n)return {state:'unchanged' as const,entityKey:key,expiresAtBlock:String(e.expiresAt),source:backend.source};
        await writer.assertCurrent();const included=await writer.extend(key,durationDays);
        const extended=await receipt(included,e.values,async current=>{
          if(included.expiresAt===undefined||current.expiresAt<included.expiresAt)fail('INTEGRITY_FAILED','Renewal expiration read-back is stale');
          return {entityKey:key,expiresAtBlock:String(current.expiresAt)};
        });
        return {state:'extended' as const,receipt:extended};});},
    async deleteOwnedEntity(args){input(args,['entityKey']);const key=entityKey(args.entityKey);
      return write(async writer=>{const e=await backend.get(key);if(address(e.owner)!==writer.account)fail('NOT_OWNER');assertNative(e,e.kind!=='communities',e.kind==='communities');
        await writer.assertCurrent();const included=await writer.delete(key);
        try{await backend.get(key);}catch(error){if(error instanceof StorageError&&error.code==='NOT_FOUND_OR_EXPIRED')return {entityKey:key,txHash:included.txHash,source:backend.source,readBackMissing:true as const};}
        throw new StorageError('WRITE_CONFIRMED_READ_PENDING','Deletion included; absence not verified',{included:true,entityKey:key,txHash:included.txHash,retryable:true});});},
  };
  // Normalize every public failure without leaking provider exceptions or RPC credentials.
  return Object.fromEntries(Object.entries(store).map(([key,method])=>[key,async(...args:unknown[])=>{
    try{return await (method as (...args:unknown[])=>Promise<unknown>)(...args);}catch(e){throw mapError(e);}
  }])) as unknown as ArkivStore;
}
