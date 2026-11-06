import type { Hex } from 'viem';
import type { StoredEntity, Values } from './backend.ts';
import type { StrategyDocumentV1, ValidateStrategyDocument, VersionRecord } from './contracts.ts';
import { address, canonical, contentHash, domainHash, entityKey, exactKeys, makeStrategyId,
  parseCanonicalRecord, parseDocument, recordBytes, requestId, searchName, name, text } from './codec.ts';
import { fail, StorageError } from './errors.ts';

export function assertNative(e: StoredEntity, readonly: boolean): void {
  if (address(e.creator) !== address(e.owner) || e.readonly !== readonly || e.permissionlessExtension) fail('UNTRUSTED_RECORD', 'Unexpected owner or creation flags');
}

export interface CommunityRecord { communitySchema:'community/1'; requestId:string; creator:Hex; name:string; description:string; contentHash:Hex }
export interface PostRecord { postSchema:'post/1'; requestId:string; creator:Hex; communityKey:Hex; strategyVersionKey?:Hex; body:string; recordHash:Hex }
export function buildCommunity(creator:Hex,request:string,title:string,description:string):CommunityRecord {
  const core={communitySchema:'community/1' as const,requestId:request,creator,name:name(title),description:text(description,0,4096)};
  return {...core,contentHash:domainHash('community',core)};
}
export function communityValues(r:CommunityRecord):Values {
  return {schemaVersion:1,requestId:r.requestId,name:r.name,nameSearch:searchName(r.name),record:recordBytes(r)};
}
export function buildPost(creator:Hex,request:string,communityKey:Hex,body:string,strategyVersionKey?:Hex):PostRecord {
  const core={postSchema:'post/1' as const,requestId:request,creator,communityKey,body:text(body,1,2000),...(strategyVersionKey?{strategyVersionKey}:{})};
  return {...core,recordHash:domainHash('post',core)};
}
export function postValues(r:PostRecord):Values {
  return {schemaVersion:1,requestId:r.requestId,community:r.communityKey,...(r.strategyVersionKey?{strategyVersion:r.strategyVersionKey}:{}),record:recordBytes(r)};
}
function metadataRecord(e:StoredEntity,kind:'communities'|'posts'):Record<string,unknown> {
  assertNative(e,kind==='posts');
  if(e.kind!==kind)fail('UNTRUSTED_RECORD');
  if(e.values.schemaVersion!==1)fail('UNSUPPORTED_SCHEMA');
  if(!(e.values.record instanceof Uint8Array))fail('INTEGRITY_FAILED');
  const r=parseCanonicalRecord(e.values.record);
  if(r.creator!==address(e.creator))fail('UNTRUSTED_RECORD');
  return r;
}
export function decodeCommunity(e:StoredEntity):CommunityRecord {
  const r=metadataRecord(e,'communities');
  try {
    exactKeys(r,['communitySchema','requestId','creator','name','description','contentHash']);
    if(r.communitySchema!=='community/1')fail('UNSUPPORTED_SCHEMA');
    const expected=buildCommunity(address(r.creator),requestId(r.requestId),name(r.name),text(r.description,0,4096));
    if(canonical(expected)!==canonical(r)||!sameValues(e.values,communityValues(expected)))fail('INTEGRITY_FAILED');
    return expected;
  }catch(error){if(error instanceof StorageError&&error.code==='UNSUPPORTED_SCHEMA')throw error;return fail('INTEGRITY_FAILED');}
}
export function decodePost(e:StoredEntity):PostRecord {
  const r=metadataRecord(e,'posts');
  try {
    exactKeys(r,['postSchema','requestId','creator','communityKey','body','recordHash'],['strategyVersionKey']);
    if(r.postSchema!=='post/1')fail('UNSUPPORTED_SCHEMA');
    const expected=buildPost(address(r.creator),requestId(r.requestId),entityKey(r.communityKey),text(r.body,1,2000),r.strategyVersionKey?entityKey(r.strategyVersionKey):undefined);
    if(canonical(expected)!==canonical(r)||!sameValues(e.values,postValues(expected)))fail('INTEGRITY_FAILED');return expected;
  }catch(error){if(error instanceof StorageError&&error.code==='UNSUPPORTED_SCHEMA')throw error;return fail('INTEGRITY_FAILED');}
}
export function buildVersion(creator: Hex, request: string, document: StrategyDocumentV1,
  refs: Partial<Pick<VersionRecord,'strategyId'|'rootVersionKey'|'parentVersionKey'|'forkSourceVersionKey'|'forkSourceContentHash'|'communityKey'>> = {}): VersionRecord {
  const core = { recordSchema:'strategy-version/1' as const, creator, strategyId:makeStrategyId(creator,request),
    requestId:request, ...refs, contentHash:contentHash(document), document };
  return { ...core, recordHash:domainHash('record',core) };
}
export function versionValues(r: VersionRecord): Values {
  return { schemaVersion:1, strategyId:r.strategyId, requestId:r.requestId, isRoot:!r.rootVersionKey,
    ...(r.rootVersionKey?{rootVersion:r.rootVersionKey}:{}), ...(r.parentVersionKey?{parentVersion:r.parentVersionKey}:{}),
    ...(r.forkSourceVersionKey?{forkSource:r.forkSourceVersionKey,forkSourceHash:r.forkSourceContentHash!}:{}),
    ...(r.communityKey?{community:r.communityKey}:{}), name:r.document.name,nameSearch:searchName(r.document.name),
    category:r.document.category,executionChainId:BigInt(r.document.executionChainId),
    tokenIn:r.document.tokenIn,tokenOut:r.document.tokenOut,contentHash:r.contentHash,record:recordBytes(r) };
}
export function sameValues(actual: Values, expected: Values): boolean {
  return Object.keys(actual).length===Object.keys(expected).length && Object.keys(actual).every(k=>Object.hasOwn(expected,k)) && Object.entries(expected).every(([key,v]) => v instanceof Uint8Array
    ? actual[key] instanceof Uint8Array && canonical([...actual[key] as Uint8Array])===canonical([...v])
    : actual[key]===v);
}
export function decodeVersion(e: StoredEntity, validator?: ValidateStrategyDocument): VersionRecord {
  assertNative(e,true);
  if (e.kind!=='versions') fail('UNTRUSTED_RECORD');
  if (!(e.values.record instanceof Uint8Array)) fail('INTEGRITY_FAILED');
  const parsed = parseCanonicalRecord(e.values.record);
  if (parsed.recordSchema!=='strategy-version/1' || e.values.schemaVersion!==1) fail('UNSUPPORTED_SCHEMA');
  try {
    exactKeys(parsed,['recordSchema','creator','strategyId','requestId','contentHash','recordHash','document'],
      ['rootVersionKey','parentVersionKey','forkSourceVersionKey','forkSourceContentHash','communityKey']);
    address(parsed.creator); entityKey(parsed.strategyId); requestId(parsed.requestId);
    entityKey(parsed.contentHash);entityKey(parsed.recordHash);
    for (const k of ['rootVersionKey','parentVersionKey','forkSourceVersionKey','forkSourceContentHash','communityKey']) if (k in parsed) entityKey(parsed[k]);
    const doc=parseDocument(parsed.document,validator);
    if(canonical(doc)!==canonical(parsed.document)) fail('INTEGRITY_FAILED');
    const r=parsed as unknown as VersionRecord;
    if(address(e.creator)!==r.creator) fail('UNTRUSTED_RECORD');
    const {recordHash,...core}=r;
    if(recordHash!==domainHash('record',core)||r.contentHash!==contentHash(doc)) fail('INTEGRITY_FAILED');
    if(Boolean(r.rootVersionKey)!==Boolean(r.parentVersionKey)||Boolean(r.forkSourceVersionKey)!==Boolean(r.forkSourceContentHash)) fail('INTEGRITY_FAILED');
    if(r.rootVersionKey && r.forkSourceVersionKey) fail('INTEGRITY_FAILED');
    if(!r.rootVersionKey && r.strategyId!==makeStrategyId(r.creator,r.requestId)) fail('INTEGRITY_FAILED');
    if(!sameValues(e.values,versionValues(r))) fail('INTEGRITY_FAILED');
    return r;
  } catch(e) {
    if(e instanceof StorageError && ['DEPENDENCY_UNAVAILABLE','UNSUPPORTED_SCHEMA','UNTRUSTED_RECORD','PAYLOAD_TOO_LARGE','INTEGRITY_FAILED'].includes(e.code)) throw e;
    return fail('INTEGRITY_FAILED','Invalid strategy record');
  }
}
