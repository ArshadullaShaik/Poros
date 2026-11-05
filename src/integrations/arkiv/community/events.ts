import { z } from 'zod';
import type { Hex } from 'viem';
import type { Json } from '../contracts.ts';
import type { EventInput, EventRecord } from './contracts.ts';
import { address, canonical, domainHash, entityKey, recordBytes, requestId, text } from '../codec.ts';
import { fail } from '../errors.ts';
const key = z.string().regex(/^0x[0-9a-f]{64}$/);
const wallet = z.string().regex(/^0x[0-9a-f]{40}$/);
const predecessor = { previousKey: key.optional() };
const utf = (min: number, max: number) => z.string().refine(value => { try { text(value,min,max); return true; } catch { return false; } });
const membership = { membershipKey: key.optional() };
const currency = z.strictObject({chainId:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),token:wallet,decimals:z.number().int().min(0).max(36)});
const shapes = {
  profile:z.strictObject({handle:z.string().regex(/^[a-z0-9_]{3,32}$/),displayName:utf(1,80),bio:utf(0,512),...predecessor}),
  membership:z.strictObject({state:z.enum(['joined','left']),...predecessor}),
  ban:z.strictObject({wallet,banned:z.boolean(),...predecessor}),
  hidden:z.strictObject({contentKey:key,hidden:z.boolean(),...predecessor}),
  moderator:z.strictObject({wallet,enabled:z.boolean(),...predecessor}),
  vote:z.strictObject({contentKey:key,value:z.union([z.literal(-1),z.literal(0),z.literal(1)]),...membership,...predecessor}),
  thread:z.strictObject({title:utf(1,80),body:utf(1,4096),...membership}),
  reply:z.strictObject({threadKey:key,body:utf(1,2000),...membership}),
  message:z.strictObject({body:utf(1,2000),...membership}),
  listing:z.strictObject({packageId:z.string().uuid(),contentHash:key,title:utf(1,80),description:utf(0,2048),terms:utf(1,4096),currency,
    amount:z.string().regex(/^[1-9][0-9]{0,77}$/).refine(value=>BigInt(value)<2n**256n)}),
  delisted:z.strictObject({listingKey:key}),
};
export function buildEvent(input: EventInput): EventRecord {
  canonical(input);
  if (Object.keys(input).sort().join(',') !== 'actor,data,requestId,scope,subject,type' || !Object.hasOwn(shapes,input.type)) fail('INVALID_INPUT');
  const parsed = shapes[input.type].safeParse(input.data);
  if (!parsed.success) fail('INVALID_INPUT','Invalid social event');
  if((input.type==='profile'||input.type==='membership')&&input.subject!==address(input.actor))fail('INVALID_INPUT');
  if(['profile','listing','delisted'].includes(input.type)){if(input.scope!=='global')fail('INVALID_INPUT');}
  else entityKey(input.scope);
  if(['thread','reply','message'].includes(input.type)&&input.subject!==input.scope)fail('INVALID_INPUT');
  const reference=input.type==='ban'||input.type==='moderator'?'wallet':input.type==='hidden'||input.type==='vote'?'contentKey':input.type==='listing'?'packageId':input.type==='delisted'?'listingKey':undefined;
  if(reference&&input.data[reference]!==input.subject)fail('INVALID_INPUT');
  const core = {eventSchema:'social-event/1' as const,type:input.type,actor:address(input.actor),subject:text(input.subject,1,128),
    scope:text(input.scope,1,128),requestId:requestId(input.requestId),data:parsed.data as Record<string,Json>};
  const result = {...core,hash:domainHash('social-event',core)}; recordBytes(result); return result;
}
export function decodeEvent(input: unknown, creator: Hex, owner: Hex, readonly: boolean, permissionlessExtension: boolean): EventRecord {
  if (!readonly || permissionlessExtension || address(creator)!==address(owner)) fail('UNTRUSTED_RECORD');
  if (!input || typeof input !== 'object') fail('INTEGRITY_FAILED');
  const {eventSchema,hash,...core} = input as EventRecord;
  const built = buildEvent(core);
  if(eventSchema!=='social-event/1'||hash!==built.hash||built.actor!==address(creator)||canonical(input)!==canonical(built))fail('INTEGRITY_FAILED');
  return built;
}
export const userId = (wallet: Hex) => `eip155:7794095:${address(wallet)}`;
export function checkedBlock(input: unknown): bigint {
  if(typeof input!=='string'||! /^(0|[1-9][0-9]{0,19})$/.test(input))fail('INVALID_INPUT');
  return BigInt(input);
}
export const checkedKey = entityKey;
