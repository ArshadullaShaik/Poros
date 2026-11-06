import {membershipRelayAddress} from '../../../integrations/arkiv/community/relay-writer.ts';
import {signalPointer,verifySignalAuthor} from '../../../integrations/arkiv/community/membership-intent.ts';
import {canonical,address,entityKey,requestId} from '../../../integrations/arkiv/codec.ts';
import {createArkivEventRepository} from '../../../integrations/arkiv/community/repository.ts';
import {createMembershipReaders} from '../../../integrations/arkiv/community/membership-network.ts';
import {createCreatorMemberships} from '../../../integrations/arkiv/community/memberships.ts';
import type {SignalContent} from '../../../integrations/arkiv/community/memberships.ts';
import type {EventDTO,EventRepository} from '../../../integrations/arkiv/community/contracts.ts';
type Hex=EventDTO['actor'];
import {validateMemberContent,validateSwarmPointer,memberContentHash,type SwarmMessagePointer} from '../../../integrations/arkiv/community/member-content.ts';
import {validatePriceStrategy} from '../market/config.ts';
import {isAbsolute} from 'node:path';
import {readBoundedJson} from '../ai/zero-g.ts';
import {openMemberContentState,memberFailure,type MemberContentState} from './member-content-state.ts';

export function checkedMemberContent(value:unknown){return validateMemberContent(value,input=>{const checked=validatePriceStrategy(input);return checked.valid&&checked.strategy.riskPolicy.paperTradingOnly;});}
type Memberships=Pick<ReturnType<typeof createCreatorMemberships>,'canReadSignal'|'members'>;
export function createMemberContentService({state,events,memberships,beeUrl,batchId,fetcher=fetch,now=Date.now,authorization}: {
 state:MemberContentState;events:Pick<EventRepository,'read'>;memberships:Memberships;beeUrl:string;batchId:string;
 fetcher?:typeof fetch;now?:()=>number|Promise<number>;authorization?:string;
}) {
 const base=new URL(beeUrl);
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||!/^[a-f0-9]{64}$/.test(batchId))throw new Error('Invalid Bee configuration');
 if(base.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Use HTTPS for a remote Bee node');
 let active=0;
 async function bounded<T>(run:()=>Promise<T>):Promise<T>{if(active>=4)memberFailure('RATE_LIMITED');active++;try{return await run();}finally{active--;}}
 async function bee(path:string,init:RequestInit,max:number){
  const signal=AbortSignal.timeout(30000);
  const response=await fetcher(new URL(base.href.replace(/\/$/,'')+'/'+path),{...init,redirect:'error',headers:{...authorization?{Authorization:authorization}:{},...init.headers},signal});
  if(!response.ok){await response.body?.cancel();memberFailure('SWARM_UNAVAILABLE');}
  return readBoundedJson(response,max,'INVALID_OUTPUT',signal);
 }
 async function retrieve(reference:string,hash:string){
  const content=checkedMemberContent(await bee('bytes/'+reference,{method:'GET'},8800));
  if(memberContentHash(content)!==hash)memberFailure('CONTENT_UNAVAILABLE');return content;
 }
 const pointer=(row:NonNullable<ReturnType<MemberContentState['publication']>>):SwarmMessagePointer=>({format:'swarm-message/1',publicationId:row.publicationId,swarmAddress:row.reference!.slice(0,64),payloadHash:entityKey(row.hash),source:row.content.source});
 return {
  async assertUploadReady(){
   await bee('readiness',{method:'GET'},2048);
   const batch=await bee('stamps/'+batchId,{method:'GET'},8192);
   if(batch.usable!==true)memberFailure('SWARM_UNAVAILABLE');
  },
  async upload({creator,publicationId,content,retryUncertain=false}:{creator:Hex;publicationId:string;content:SignalContent;retryUncertain?:boolean}){
   address(creator);requestId(publicationId);content=checkedMemberContent(content);
   const row=state.prepare(creator,publicationId,memberContentHash(content),content);
   return bounded(async()=>{
    if(row.status==='uploaded'&&row.reference){await retrieve(row.reference,row.hash);return pointer(row);}
    state.begin(creator,publicationId,retryUncertain);
    try{
     const result=await bee('bytes',{method:'POST',headers:{'Content-Type':'application/octet-stream','swarm-encrypt':'true','swarm-postage-batch-id':batchId,'swarm-deferred-upload':'false'},body:canonical(content)},2048);
     if(typeof result.reference!=='string'||!/^[a-f0-9]{128}$/.test(result.reference))memberFailure('SWARM_UNAVAILABLE');
     // Preserve a returned key before read-back so a failed read cannot force a second paid upload.
     state.finish(creator,publicationId,result.reference);
     await retrieve(result.reference,row.hash);
     return pointer(state.publication(creator,publicationId)!);
    }catch(error){state.uncertain(creator,publicationId);if(state.publication(creator,publicationId)?.status==='uncertain')memberFailure('UPLOAD_UNCERTAIN');throw error;}
   });
  },
  async read({wallet,signalKey}:{wallet:Hex;signalKey:Hex}){
   address(wallet);entityKey(signalKey);
   const signal=await events.read(signalKey);
   if(signal.key!==signalKey)memberFailure('CONTENT_UNAVAILABLE');
   if(signal.data.format!=='swarm-message/1')memberFailure('LEGACY_MESSAGE');
   const creator=await verifySignalAuthor(signal);
   const expected=signalPointer(signal);
   if(signal.type==='private-signal-relay'&&state.job('publish',creator,expected.publicationId)?.result?.key!==signal.key)memberFailure('CONTENT_UNAVAILABLE');
   if(!await memberships.canReadSignal({signal,wallet,now:await now()}))memberFailure('MEMBERSHIP_EXPIRED');
   const row=state.publication(creator,expected.publicationId);
   if(!row?.reference||row.status!=='uploaded'||canonical(pointer(row))!==canonical(expected))memberFailure('CONTENT_UNAVAILABLE');
   const content=await bounded(()=>retrieve(row.reference!,row.hash));
   const finished=await now();
   if(!await memberships.canReadSignal({signal,wallet,now:finished}))memberFailure('MEMBERSHIP_EXPIRED');
   const expiresAt=wallet===creator?null:(await memberships.members(creator)).find(member=>member.wallet===wallet)?.expiresAt;
   if(wallet!==creator&&(!expiresAt||expiresAt<=finished))memberFailure('MEMBERSHIP_EXPIRED');
   return {content,expiresAt:expiresAt??null};
  },
 };
}
let current:ReturnType<typeof createRuntime>|undefined;
function createRuntime(){
 const {SWARM_BEE_URL:beeUrl,SWARM_POSTAGE_BATCH_ID:batchId,MEMBERSHIP_DB_PATH:path,MEMBERSHIP_MASTER_KEY:key,MEMBERSHIP_ORIGIN:origin}=process.env;
 if(!beeUrl||!batchId||!path||!key||!origin)return null;
 if(!isAbsolute(path))throw new Error('Configure a persistent absolute membership database path');
 const url=new URL(origin);if(url.origin!==origin||(!['https:'].includes(url.protocol)&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Configure a canonical HTTPS membership origin');
 const bytes=Buffer.from(key,'base64');if(bytes.length!==32||bytes.toString('base64')!==key)throw new Error('Configure a base64 32-byte membership key');
 const state=openMemberContentState(path,bytes,false,!process.env.MEMBERSHIP_RELAY_PRIVATE_KEY);
 if(process.env.MEMBERSHIP_RELAY_PRIVATE_KEY)state.recoverLegacyUploads();
 try{
  const events=createArkivEventRepository({accessKey:process.env.ARKIV_ACCESS_KEY});
  const readers=createMembershipReaders(process.env.ARKIV_ACCESS_KEY,process.env.SEPOLIA_RPC_URL??'https://ethereum-sepolia-rpc.publicnode.com');
  const memberships=createCreatorMemberships(events,readers);
  return {origin,state,events,readers,memberships,relayActor:process.env.MEMBERSHIP_RELAY_PRIVATE_KEY?membershipRelayAddress(process.env.MEMBERSHIP_RELAY_PRIVATE_KEY as Hex):undefined,service:createMemberContentService({state,events,memberships,beeUrl,batchId,now:readers.now,authorization:process.env.SWARM_BEE_AUTHORIZATION})};
 }catch(error){state.close();throw error;}
}
export function getMemberContentRuntime(){if(current===undefined)current=createRuntime();return current;}
