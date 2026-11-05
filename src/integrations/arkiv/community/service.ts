import type { Hex } from 'viem';
import type { Json } from '../contracts.ts';
import type { EventDTO, EventType, HubOptions, Listing, ListingInput, Profile, ProfileInput, VoteSummary } from './contracts.ts';
import { address, canonical, entityKey, requestId } from '../codec.ts';
import { fail } from '../errors.ts';
import { buildEvent, checkedBlock, userId } from './events.ts';
function invalidAuthorState(error:unknown){return !!error&&typeof error==='object'&&'code'in error&&
  ['CONCURRENT_UPDATE','HISTORY_INCOMPLETE','INTEGRITY_FAILED','UNTRUSTED_RECORD','INVALID_INPUT','PAYLOAD_TOO_LARGE','UNSUPPORTED_SCHEMA'].includes(String(error.code));}

export function createCommunityHub({events,strategies}:HubOptions) {
  function latest(rows:EventDTO[]) {
    if(!rows.length)return undefined;
    const keys=new Set(rows.map(row=>row.key));const parents=new Set<Hex>();
    for(const row of rows)if(row.data.previousKey){const parent=entityKey(row.data.previousKey);if(!keys.has(parent))fail('HISTORY_INCOMPLETE');parents.add(parent);}
    const tips=rows.filter(row=>!parents.has(row.key));if(tips.length!==1)fail('CONCURRENT_UPDATE');
    const visited=new Set<Hex>();let current:EventDTO|undefined=tips[0];
    while(current){if(visited.has(current.key))fail('INTEGRITY_FAILED');visited.add(current.key);const parent=current.data.previousKey;
      const child=current;current=parent?rows.find(row=>row.key===parent):undefined;
      if(current&&BigInt(current.createdAtBlock)>BigInt(child.createdAtBlock))fail('INTEGRITY_FAILED');}
    if(visited.size!==rows.length)fail('CONCURRENT_UPDATE');return tips[0];
  }
  async function state(type:EventType,subject:string,scope:string,actor:Hex,atBlock?:bigint) {
    const rows=(await events.scan({type,subject,scope,actor})).filter(row=>atBlock===undefined||BigInt(row.createdAtBlock)<=atBlock);
    return latest(rows);
  }
  async function append(type:EventType,subject:string,scope:string,request:string,data:Record<string,Json>,actor:Hex) {
    return events.append({type,subject,scope,requestId:requestId(request),data,actor});
  }
  async function change(type:EventType,subject:string,scope:string,request:string,data:Record<string,Json>,actor:Hex,previousKey?:Hex) {
    const old=await events.scan({actor,requestId:requestId(request)});
    const inferred=['ban','hidden','moderator','vote'].includes(type)?(old[0]?old[0].data.previousKey:(await state(type,subject,scope,actor))?.key):undefined;
    const parent=previousKey??(inferred?entityKey(inferred):undefined);
    const input={type,subject,scope,requestId:requestId(request),data:{...data,...(parent?{previousKey:parent}:{})},actor};
    const built=buildEvent(input);
    if(old.length>1)fail('DUPLICATE_REQUEST');
    if(old[0]){if(old[0].hash!==built.hash)fail('IDEMPOTENCY_CONFLICT');return old[0];}
    const latest=await state(type,subject,scope,actor);
    if(latest?.key!==parent)fail('CONCURRENT_UPDATE','Expected current state predecessor');
    return events.append(input);
  }
  async function owner(communityKey:Hex) { return (await strategies.getCommunity({communityKey:entityKey(communityKey)})).owner; }
  async function banned(communityKey:Hex,wallet:Hex,atBlock?:bigint) {
    const creator=await owner(communityKey);return (await state('ban',wallet,communityKey,creator,atBlock))?.data.banned===true;
  }
  async function member(communityKey:Hex,wallet:Hex,atBlock?:bigint) {
    const creator=await owner(communityKey);
    if(await banned(communityKey,wallet,atBlock))fail('NOT_OWNER','Member is banned');
    if(creator===wallet)return undefined;
    const joined=await state('membership',wallet,communityKey,wallet,atBlock);
    if(joined?.data.state!=='joined')fail('NOT_OWNER','Join the community first');return joined;
  }
  async function moderator(communityKey:Hex,wallet:Hex,atBlock?:bigint) {
    const creator=await owner(communityKey);
    if(wallet===creator)return true;
    const role=await state('moderator',wallet,communityKey,creator,atBlock);
    if(role?.data.enabled!==true)return false;
    try{await member(communityKey,wallet,atBlock);return true;}
    catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='NOT_OWNER')return false;throw error;}
  }
  async function hidden(communityKey:Hex,contentKey:Hex) {
    const creator=await owner(communityKey);
    const rows=await events.scan({type:'hidden',subject:contentKey,scope:communityKey});
    const authorized:EventDTO[]=[];
    for(const row of rows){
      if(row.actor===creator){authorized.push(row);continue;}
      try{if(await moderator(communityKey,row.actor,BigInt(row.createdAtBlock)))authorized.push(row);}
      catch(error){if(!invalidAuthorState(error))throw error;}
    }
    const valid:EventDTO[]=[];
    for(const actor of new Set(authorized.map(row=>row.actor))){
      try{const own=latest(authorized.filter(row=>row.actor===actor));if(own)valid.push(own);}
      catch(error){if(actor===creator||!invalidAuthorState(error))throw error;}
    }
    valid.sort((a,b)=>BigInt(a.createdAtBlock)<BigInt(b.createdAtBlock)?-1:BigInt(a.createdAtBlock)>BigInt(b.createdAtBlock)?1:
      a.data.hidden===b.data.hidden?a.key.localeCompare(b.key):a.data.hidden?1:-1);
    return valid.at(-1)?.data.hidden===true;
  }
  async function permitted(row:EventDTO,communityKey:Hex) {
    if(row.scope!==communityKey||row.subject!==communityKey)fail('UNTRUSTED_RECORD');
    const creator=await owner(communityKey);const block=BigInt(row.createdAtBlock);
    if(await banned(communityKey,row.actor,block))return false;
    let joined:EventDTO|undefined;
    if(row.actor!==creator){
      try{joined=await state('membership',row.actor,communityKey,row.actor,block);}
      catch(error){if(invalidAuthorState(error))return false;throw error;}
      if(joined?.data.state!=='joined')return false;
    }
    if(joined?.key!==row.data.membershipKey)fail('UNTRUSTED_RECORD');
    if(await banned(communityKey,row.actor))return false;
    return !(await hidden(communityKey,row.key));
  }
  async function visible(type:'thread'|'reply'|'message',communityKey:Hex,afterBlock?:string) {
    await owner(communityKey);if(afterBlock!==undefined)checkedBlock(afterBlock);
    const rows=await events.scan({type,subject:communityKey,scope:communityKey,...(afterBlock!==undefined?{afterBlock}:{})});
    const result:EventDTO[]=[];
    for(const row of rows){try{if(await permitted(row,communityKey))result.push(row);}catch(e){
      if(!e||typeof e!=='object'||!('code'in e)||!['NOT_OWNER','UNTRUSTED_RECORD'].includes(String(e.code)))throw e;
    }}
    return result.sort((a,b)=>BigInt(a.createdAtBlock)<BigInt(b.createdAtBlock)?-1:BigInt(a.createdAtBlock)>BigInt(b.createdAtBlock)?1:a.key.localeCompare(b.key));
  }
  async function content(type:'thread'|'reply'|'message',args:{requestId:string;communityKey:Hex;body:string;title?:string;threadKey?:Hex}) {
    const actor=await events.actor();const communityKey=entityKey(args.communityKey);const joined=await member(communityKey,actor);
    if(type==='reply') {const thread=await events.read(entityKey(args.threadKey));
      if(thread.type!=='thread'||thread.scope!==communityKey||!(await permitted(thread,communityKey)))fail('INVALID_INPUT','Thread unavailable');}
    return append(type,communityKey,communityKey,args.requestId,{body:args.body,...(args.title!==undefined?{title:args.title}:{}),
      ...(args.threadKey?{threadKey:args.threadKey}:{}),...(joined?{membershipKey:joined.key}:{})},actor);
  }
  function profile(row:EventDTO):Profile { return {userId:userId(row.actor),wallet:row.actor,handle:String(row.data.handle),displayName:String(row.data.displayName),bio:String(row.data.bio),key:row.key,source:row.source}; }
  const hub={
    async saveProfile(args:ProfileInput) {const actor=await events.actor();return profile(await change('profile',actor,'global',args.requestId,
      {handle:args.handle,displayName:args.displayName,bio:args.bio},actor,args.previousKey));},
    async getProfile({wallet}:{wallet:Hex}) {const row=await state('profile',address(wallet),'global',address(wallet));return row?profile(row):null;},
    async searchProfiles({handle}:{handle:string}) {if(!/^[a-z0-9_]{3,32}$/.test(handle))fail('INVALID_INPUT');
      const actors=new Set((await events.scan({type:'profile',scope:'global'})).map(row=>row.actor));const result:Profile[]=[];
      for(const actor of actors){try{const row=await state('profile',actor,'global',actor);if(row?.data.handle===handle)result.push(profile(row));}
        catch(error){if(!invalidAuthorState(error))throw error;}}
      return result;},
    async setMembership(args:{requestId:string;communityKey:Hex;state:'joined'|'left';previousKey?:Hex}) {
      const actor=await events.actor();await owner(args.communityKey);if(await banned(args.communityKey,actor))fail('NOT_OWNER');
      return change('membership',actor,args.communityKey,args.requestId,{state:args.state},actor,args.previousKey);},
    async getMembership(args:{communityKey:Hex;wallet:Hex}) {await owner(args.communityKey);return {event:await state('membership',address(args.wallet),args.communityKey,address(args.wallet)),banned:await banned(args.communityKey,address(args.wallet))};},
    async setBan(args:{requestId:string;communityKey:Hex;wallet:Hex;banned:boolean;previousKey?:Hex}) {
      const actor=await events.actor();if(actor!==await owner(args.communityKey)||address(args.wallet)===actor)fail('NOT_OWNER');
      return change('ban',address(args.wallet),args.communityKey,args.requestId,{wallet:address(args.wallet),banned:args.banned},actor,args.previousKey);},
    async setModerator(args:{requestId:string;communityKey:Hex;wallet:Hex;enabled:boolean;previousKey?:Hex}) {
      const actor=await events.actor(),wallet=address(args.wallet),communityKey=entityKey(args.communityKey);
      if(actor!==await owner(communityKey)||wallet===actor)fail('NOT_OWNER');
      return change('moderator',wallet,communityKey,args.requestId,{wallet,enabled:args.enabled},actor,args.previousKey);},
    async isModerator({communityKey,wallet}:{communityKey:Hex;wallet:Hex}) {return moderator(entityKey(communityKey),address(wallet));},
    async setHidden(args:{requestId:string;communityKey:Hex;contentKey:Hex;hidden:boolean;previousKey?:Hex}) {
      const actor=await events.actor();if(!(await moderator(args.communityKey,actor)))fail('NOT_OWNER');const row=await events.read(entityKey(args.contentKey));
      if(!['thread','reply','message'].includes(row.type)||row.scope!==args.communityKey)fail('INVALID_INPUT');
      return change('hidden',row.key,args.communityKey,args.requestId,{contentKey:row.key,hidden:args.hidden},actor,args.previousKey);},
    async setVote(args:{requestId:string;communityKey:Hex;contentKey:Hex;value:-1|0|1;previousKey?:Hex}) {
      const actor=await events.actor(),communityKey=entityKey(args.communityKey),contentKey=entityKey(args.contentKey);
      const joined=await member(communityKey,actor),target=await events.read(contentKey);
      if(!['thread','reply'].includes(target.type)||target.scope!==communityKey||!(await permitted(target,communityKey)))fail('INVALID_INPUT');
      return change('vote',contentKey,communityKey,args.requestId,{contentKey,value:args.value,...(joined?{membershipKey:joined.key}:{})},actor,args.previousKey);},
    async getVoteSummaries({communityKey,contentKeys,viewer}:{communityKey:Hex;contentKeys:Hex[];viewer?:Hex}) {
      // shortcut: one bounded scan per community, add an indexed read model before large public feeds.
      communityKey=entityKey(communityKey);if(!Array.isArray(contentKeys)||contentKeys.length>500)fail('INVALID_INPUT');
      const keys=new Set(contentKeys.map(entityKey));const summaries={} as Record<Hex,VoteSummary>;const targets=new Map<Hex,EventDTO>();
      for(const key of keys){const target=await events.read(key);if(!['thread','reply'].includes(target.type)||target.scope!==communityKey)fail('INVALID_INPUT');
        targets.set(key,target);summaries[key]={score:0,up:0,down:0,viewerVote:0};}
      if(!keys.size)return summaries;
      const rows=(await events.scan({type:'vote',scope:communityKey})).filter(row=>keys.has(entityKey(row.subject)));
      const groups=new Map<string,EventDTO[]>();for(const row of rows){const key=`${row.subject}:${row.actor}`;groups.set(key,[...(groups.get(key)??[]),row]);}
      for(const group of groups.values()){
        const authorized:EventDTO[]=[];
        for(const row of group){if(BigInt(row.createdAtBlock)<BigInt(targets.get(row.subject as Hex)!.createdAtBlock))continue;
          try{const joined=await member(communityKey,row.actor,BigInt(row.createdAtBlock));
          if(joined?.key===row.data.membershipKey)authorized.push(row);}
          catch(error){if(!invalidAuthorState(error)&&!(error&&typeof error==='object'&&'code'in error&&error.code==='NOT_OWNER'))throw error;}}
        let vote:EventDTO|undefined;
        try{vote=latest(authorized);if(!vote)continue;}
        catch(error){if(invalidAuthorState(error))continue;throw error;}
        const summary=summaries[vote.subject as Hex];if(!summary)continue;
        const value=vote.data.value as -1|0|1;if(value===1)summary.up++;if(value===-1)summary.down++;
        summary.score=summary.up-summary.down;if(viewer&&vote.actor===address(viewer))summary.viewerVote=value;
      }
      return summaries;},
    createThread:(args:{requestId:string;communityKey:Hex;title:string;body:string})=>content('thread',args),
    reply:(args:{requestId:string;communityKey:Hex;threadKey:Hex;body:string})=>content('reply',args),
    sendMessage:(args:{requestId:string;communityKey:Hex;body:string})=>content('message',args),
    listThreads:({communityKey}:{communityKey:Hex})=>visible('thread',communityKey),
    async listReplies({communityKey,threadKey}:{communityKey:Hex;threadKey:Hex}) {const parent=await events.read(entityKey(threadKey));
      if(parent.type!=='thread'||parent.scope!==communityKey||!(await permitted(parent,communityKey)))fail('INVALID_INPUT');return (await visible('reply',communityKey)).filter(row=>row.data.threadKey===threadKey);},
    listMessages:({communityKey,afterBlock}:{communityKey:Hex;afterBlock?:string})=>visible('message',communityKey,afterBlock),
    async publishListing(args:ListingInput) {const actor=await events.actor();const {requestId:request,...data}=args;
      return append('listing',args.packageId,'global',request,data as unknown as Record<string,Json>,actor);},
    async getListing({listingKey}:{listingKey:Hex}):Promise<Listing> {const row=await events.read(entityKey(listingKey));if(row.type!=='listing'||row.scope!=='global'||row.subject!==row.data.packageId)fail('UNTRUSTED_RECORD');
      const delisted=await events.scan({type:'delisted',subject:row.key,scope:'global',actor:row.actor});
      return {...row.data,key:row.key,seller:row.actor,active:delisted.length===0,expiresAtBlock:row.expiresAtBlock,source:row.source} as unknown as Listing;},
    async listListings({seller}:{seller?:Hex}={}) {const rows=await events.scan({type:'listing',scope:'global',...(seller?{actor:address(seller)}:{})});return Promise.all(rows.map(row=>hub.getListing({listingKey:row.key})));},
    async delist({listingKey,requestId:request}:{listingKey:Hex;requestId:string}) {const actor=await events.actor();const listing=await hub.getListing({listingKey});if(listing.seller!==actor)fail('NOT_OWNER');return append('delisted',listingKey,'global',request,{listingKey},actor);},
  };
  return hub;
}
export type CommunityHub = ReturnType<typeof createCommunityHub>;
