import type {Hex} from 'viem';
import type {EventRepository} from '../../../src/integrations/arkiv/community/contracts.ts';
import type {CreatorMemberships} from '../../../src/integrations/arkiv/community/memberships.ts';
import type {SignalContent} from '../../../src/integrations/arkiv/community/memberships.ts';
import {memberStrategy} from './member-strategy.ts';
import type {ArkivStore} from '../../../src/integrations/arkiv/contracts.ts';
import type {CommunityHub} from '../../../src/integrations/arkiv/community/service.ts';

// Shared posts pin a version; they do not change the strategy's original community.
export async function readCommunityStrategies(strategies:Pick<ArkivStore,'listStrategies'>,community:Pick<CommunityHub,'listThreads'>,
  {communityKey,page={}}:{communityKey:Hex;page?:{offset?:number;limit?:number}}) {
  const offset=page.offset??0,limit=page.limit??20;
  if(!/^0x[0-9a-f]{64}$/i.test(communityKey)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('Invalid community page.');
  const posts=await community.listThreads({communityKey});
  const shared=new Map<Hex,{name:string;rootVersionKey?:Hex;postKey?:Hex;communityKey:Hex}>();
  for(const post of [...posts].reverse()) {
    const key=post.data.strategyVersionKey;
    if(typeof key==='string'&&/^0x[0-9a-f]{64}$/i.test(key)&&!shared.has(key as Hex))
      shared.set(key as Hex,{name:String(post.data.title),rootVersionKey:key as Hex,communityKey});
    else if(!key)shared.set(post.key,{name:String(post.data.title),postKey:post.key,communityKey});
  }
  const items=[...shared.values()].slice(offset,offset+limit);
  if(items.length===limit)return {items,nextOffset:offset+limit};
  const rootOffset=Math.max(0,offset-shared.size);
  const roots=await strategies.listStrategies({communityKey,page:{offset:rootOffset,limit:limit-items.length}});
  for(const row of roots.items) {
    if(row.communityKey!==communityKey)throw new Error('Invalid community response.');
    if(!shared.has(row.rootVersionKey))items.push({name:row.name,rootVersionKey:row.rootVersionKey,communityKey:row.communityKey});
  }
  return {items,nextOffset:roots.nextOffset===null?null:shared.size+roots.nextOffset};
}

export async function readCommunityPost(community:Pick<CommunityHub,'listThreads'>,communityKey:Hex,postKey:Hex) {
  if(![communityKey,postKey].every(key=>/^0x[0-9a-f]{64}$/i.test(key)))throw new Error('Invalid community post.');
  const post=(await community.listThreads({communityKey})).find(row=>row.key===postKey);
  if(!post)throw new Error('This post is no longer available in the community.');
  return {id:post.key,versionId:post.key,name:String(post.data.title),text:String(post.data.body)};
}

type Readers={now:()=>Promise<number>};
export async function readMemberLibrary({account,events,service,readers,getProfile,readMessages}: {
  account:Hex;events:Pick<EventRepository,'scan'>;service:CreatorMemberships;readers:Readers;
  getProfile:(wallet:Hex)=>Promise<{displayName:string}|null>;
  readMessages:(keys:Hex[])=>Promise<{signalKey:Hex;content:SignalContent;expiresAt:number|null}[]>;}){
  const subscriptions=await service.subscriptions(account);
  const ids=[...new Set(subscriptions.map(row=>row.creator))];
  if(ids.length>100)throw new Error('Too many creator memberships to load in this sidebar. Open your community profile.');
  const now=await readers.now(),creators:{id:Hex;name:string;expiresAt:number}[]=[];
  for(const id of ids){
    if(!/^0x[0-9a-f]{40}$/i.test(id))throw new Error('Invalid creator membership.');
    const member=(await service.members(id as Hex)).find(row=>row.wallet===account&&row.expiresAt>now);
    if(member){const profile=await getProfile(id as Hex);creators.push({id:id as Hex,name:profile?.displayName??id,expiresAt:member.expiresAt});}
  }
  const candidates:{key:Hex;expiresAt:number;block:bigint}[]=[];
  for(const creator of creators){
    for(const signal of await service.signals(creator.id)){
      if(signal.data.format!=='swarm-message/1'||!await service.canReadSignal({signal,wallet:account,now}))continue;
      candidates.push({key:signal.key,expiresAt:creator.expiresAt,block:BigInt(signal.createdAtBlock)});
    }
  }
  candidates.sort((a,b)=>a.block>b.block?-1:a.block<b.block?1:a.key.localeCompare(b.key));
  candidates.splice(20);
  const messages=candidates.length?await readMessages(candidates.map(row=>row.key)):[];
  if(messages.length!==candidates.length)throw new Error('Member messages could not be verified.');
  const entries=messages.map((message,index)=>{
    const expected=candidates[index]!;
    if(message.signalKey!==expected.key||message.expiresAt===null)throw new Error('Member messages could not be verified.');
    if(message.content.body.length>4000&&!message.content.strategy)throw new Error('A creator strategy exceeds the interpreter limit. Open it on the community page.');
    return {...memberStrategy(message.content,message.signalKey),expiresAt:Math.min(expected.expiresAt,message.expiresAt),memberWallet:account};
  });
  const finishedAt=await readers.now();
  if(creators.some(row=>row.expiresAt<=finishedAt)||entries.some(row=>row.expiresAt<=finishedAt))throw new Error('Membership expired. Refresh your library.');
  return {creators,entries,locked:false};
}
