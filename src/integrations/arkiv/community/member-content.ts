import {sha256,toBytes,type Hex} from 'viem';
import {canonical,byteLength,entityKey,requestId,text} from '../codec.ts';
import {fail} from '../errors.ts';
import type {SignalContent} from './memberships.ts';

export interface SwarmMessagePointer {
  format:'swarm-message/1'; publicationId:string; swarmAddress:string; payloadHash:Hex; source:SignalContent['source'];
}
export function validateMemberContent(input:unknown,validStrategy?:(value:unknown)=>boolean):SignalContent {
  canonical(input);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_INPUT');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['title','body','source','strategy','communityKey'].includes(key))||
    !['manual','ai-proposal','rule-engine'].includes(String(value.source)))fail('INVALID_INPUT');
  text(value.title,1,100);text(value.body,1,4096);
  if(!(value.title as string).trim()||!(value.body as string).trim())fail('INVALID_INPUT');
  if(value.communityKey!==undefined)entityKey(value.communityKey);
  if(value.strategy!==undefined&&!validStrategy?.(value.strategy))fail('INVALID_INPUT','Attach valid virtual-fund rules.');
  if(byteLength(canonical(input))>8800)fail('PAYLOAD_TOO_LARGE');
  return input as SignalContent;
}
export function memberContentHash(content:SignalContent):Hex {return sha256(toBytes(canonical(content)));}
export function validateSwarmPointer(value:unknown):SwarmMessagePointer {
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_INPUT');
  const row=value as SwarmMessagePointer;
  if(Object.keys(row).sort().join(',')!=='format,payloadHash,publicationId,source,swarmAddress'||row.format!=='swarm-message/1'||
    !/^[0-9a-f]{64}$/.test(row.swarmAddress)||!['manual','ai-proposal','rule-engine'].includes(row.source))fail('INVALID_INPUT');
  requestId(row.publicationId);entityKey(row.payloadHash);return row;
}
