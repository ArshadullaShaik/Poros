import type {ArkivStore,CommunityDTO,StrategySummaryDTO,Page} from '../../../src/integrations/arkiv/contracts.ts';
import type {Profile} from '../../../src/integrations/arkiv/community/contracts.ts';
const prefix='poros.public.7794095.strategyhub-v1.',freshFor=30000,maxAge=300000;
type Entry={at:number;value:unknown};
export function createPublicReadCache({storage,now=Date.now,onCached=()=>{},onRefresh=(_key:string,_changed:boolean)=>{},onError=()=>{}}:{
  storage?:Storage;now?:()=>number;onCached?:()=>void;onRefresh?:(key:string,changed:boolean)=>void;onError?:()=>void;
}={}){
  const memory=new Map<string,Entry>(),pending=new Map<string,Promise<unknown>>();let generation=0;
  async function read<T>(key:string,load:()=>Promise<T>,valid:(value:unknown)=>value is T):Promise<T>{
    let entry=memory.get(key);
    if(!entry)try{const raw=storage?.getItem(prefix+key);if(raw&&raw.length<=250000)entry=JSON.parse(raw) as Entry;}catch{}
    const time=now(),version=generation;
    if(!entry||!Number.isFinite(entry.at)||entry.at>time||time-entry.at>maxAge||!valid(entry.value))entry=undefined;
    if(entry)memory.set(key,entry);
    const saved=entry;
    const refresh=()=>{
      const existing=pending.get(key);if(existing)return existing as Promise<T>;
      const current=generation;
      const job=Promise.resolve().then(load).then(value=>{
        if(!valid(value))throw new Error('Invalid public cache response.');
        if(current===generation){
          const next={at:now(),value};memory.set(key,next);if(memory.size>40)memory.delete(memory.keys().next().value!);
          try{
            const keys=Array.from({length:storage?.length??0},(_,i)=>storage!.key(i)).filter((k):k is string=>!!k?.startsWith(prefix));
            if(keys.length>=40&&!keys.includes(prefix+key))storage?.removeItem(keys[0]!);
            const raw=JSON.stringify(next);if(raw.length<=250000)storage?.setItem(prefix+key,raw);
          }catch{}
          onRefresh(key,!!saved&&JSON.stringify(saved.value)!==JSON.stringify(value));
        }
        return value;
      }).finally(()=>{if(current===generation)pending.delete(key);});
      pending.set(key,job);return job;
    };
    if(entry){
      if(time-entry.at>=freshFor){onCached();void refresh().catch(()=>{if(generation===version)onError();});}
      return entry.value as T;
    }
    return refresh();
  }
  function clear(){
    generation++;memory.clear();pending.clear();
    try{const keys=Array.from({length:storage?.length??0},(_,i)=>storage!.key(i));for(const key of keys)if(key?.startsWith(prefix))storage?.removeItem(key);}catch{}
  }
  return {read,clear};
}
export function browserStorage(){try{return typeof window==='undefined'?undefined:window.localStorage;}catch{return undefined;}}
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
const address=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
const key=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
function page<T>(value:unknown,item:(v:unknown)=>boolean):value is Page<T>{
 return object(value)&&value.source==='arkiv'&&Array.isArray(value.items)&&value.items.length<=100&&value.items.every(item)&&integer(value.offset)&&integer(value.limit)&&integer(value.skipped)&&(value.nextOffset===null||integer(value.nextOffset))&&text(value.blockNumber,30)&&/^\d+$/.test(value.blockNumber);
}
export const validCommunities=(v:unknown):v is Page<CommunityDTO>=>page(v,item=>object(item)&&item.source==='arkiv'&&key(item.communityKey)&&address(item.creator)&&address(item.owner)&&text(item.name,128)&&text(item.description,4096)&&key(item.contentHash)&&text(item.expiresAtBlock,30));
export const validStrategies=(v:unknown):v is Page<StrategySummaryDTO>=>page(v,item=>object(item)&&item.source==='arkiv'&&key(item.strategyId)&&key(item.rootVersionKey)&&address(item.creator)&&text(item.name,128)&&['dca','rebalance','signal','other'].includes(item.category)&&integer(item.executionChainId)&&address(item.tokenIn)&&address(item.tokenOut)&&(item.communityKey===undefined||key(item.communityKey))&&text(item.expiresAtBlock,30));
export const validProfile=(v:unknown):v is Profile|null=>v===null||object(v)&&v.source==='arkiv'&&address(v.wallet)&&text(v.userId,128)&&text(v.handle,32)&&text(v.displayName,100)&&text(v.bio,512)&&key(v.key);
export function cachedPublicLists(api:ArkivStore,cache:ReturnType<typeof createPublicReadCache>){
 return {
  listCommunities:(input:Parameters<ArkivStore['listCommunities']>[0]={})=>cache.read('communities:'+JSON.stringify(input),()=>api.listCommunities(input),validCommunities),
  listStrategies:(input:Parameters<ArkivStore['listStrategies']>[0]={})=>cache.read('strategies:'+JSON.stringify(input),()=>api.listStrategies(input),validStrategies),
 };
}
