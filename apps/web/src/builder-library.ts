import type {Hex} from 'viem';
import type {EventRepository} from '../../../src/integrations/arkiv/community/contracts.ts';
import type {CreatorMemberships,EncryptionIdentity,KeyBox} from '../../../src/integrations/arkiv/community/memberships.ts';
import {restoreEncryptionIdentity,openContentKey,decryptSignal} from './creator-crypto.ts';
import {memberStrategy} from './member-strategy.ts';

type Readers={now:()=>Promise<number>};
export async function readMemberLibrary({account,events,service,readers,getProfile,recoveryCode}: {
  account:Hex;events:Pick<EventRepository,'scan'>;service:CreatorMemberships;readers:Readers;
  getProfile:(wallet:Hex)=>Promise<{displayName:string}|null>;recoveryCode?:string;
}){
  const claims=await events.scan({type:'subscription',actor:account,scope:'global'});
  const ids=[...new Set(claims.map(row=>row.subject))];
  if(ids.length>100)throw new Error('Too many creator memberships to load in this sidebar. Open your community profile.');
  const now=await readers.now(),creators:{id:Hex;name:string;expiresAt:number}[]=[];
  for(const id of ids){
    if(!/^0x[0-9a-f]{40}$/i.test(id))throw new Error('Invalid creator membership.');
    const member=(await service.members(id as Hex)).find(row=>row.wallet===account&&row.expiresAt>now);
    if(member){const profile=await getProfile(id as Hex);creators.push({id:id as Hex,name:profile?.displayName??id,expiresAt:member.expiresAt});}
  }
  const entries:(ReturnType<typeof memberStrategy> & {expiresAt:number})[]=[];
  if(!recoveryCode)return {creators,entries,locked:true};
  const record=await service.getKey(account);
  if(!record)throw new Error('Set up private access on the community page first.');
  const privateKey=await restoreEncryptionIdentity(account,record.data as unknown as EncryptionIdentity,recoveryCode);
  for(const creator of creators){
    for(const signal of await service.signals(creator.id)){
      const envelope=await service.getEnvelope(signal,account);
      if(!envelope||envelope.data.keyRecord!==record.key)continue;
      const context=signal.actor+':'+signal.requestId;
      const key=await openContentKey(envelope.data.box as unknown as KeyBox,privateKey,context+':'+account);
      const content=await decryptSignal({iv:String(signal.data.iv),ciphertext:String(signal.data.ciphertext)},key,context);
      if(content.body.length>4000)throw new Error('A creator strategy exceeds the interpreter limit. Open it on the community page.');
      entries.push({...memberStrategy(content,signal.key),expiresAt:creator.expiresAt});
      if(entries.length>20)throw new Error('More than 20 unlocked strategies are available. Open the community page.');
    }
  }
  const finishedAt=await readers.now();
  if(creators.some(row=>row.expiresAt<=finishedAt))throw new Error('Membership expired. Refresh your library.');
  return {creators,entries,locked:false};
}
