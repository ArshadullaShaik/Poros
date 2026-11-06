import type {Hex} from 'viem';
import type {WalletBridge} from './integration.ts';
import type {SignalContent} from '../../../src/integrations/arkiv/community/memberships.ts';
import {canonical} from '../../../src/integrations/arkiv/codec.ts';
import {validateMemberContent,memberContentHash,validateSwarmPointer} from '../../../src/integrations/arkiv/community/member-content.ts';
import {validatePriceStrategy} from '../../../src/features/builder/market/config.ts';

export const validateMemberDraft=(value:unknown)=>validateMemberContent(value,input=>{const result=validatePriceStrategy(input);return result.valid&&result.strategy.riskPolicy.paperTradingOnly;});
export function createMemberContentClient({wallet,fetcher=fetch}:{wallet:WalletBridge;fetcher?:typeof fetch}){
 async function request(operation:'upload'|'read',target:Record<string,unknown>,fields:Record<string,unknown>={}){
  const original=await wallet.getContext(),account=original.account.toLowerCase() as Hex;
  let changed=false;const unsubscribe=wallet.subscribe?.(()=>{changed=true;});
  async function guard(){const current=await wallet.getContext();if(changed||current.account.toLowerCase()!==account||current.provider!==original.provider)throw new Error('Wallet account changed. Refresh your messages.');}
  async function post(path:string,body:unknown){
   const response=await fetcher('/api/member-content/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(120000)});
   const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error?.message??'Messages are unavailable. Try again.'),{code:result.error?.code});return result.data;
  }
  try{
   const challenge=await post('challenge',{wallet:account,operation,target});
   const proof=JSON.parse(challenge.message);
   if(proof.domain!=='poros:member-content:1'||proof.wallet!==account||proof.operation!==operation||canonical(proof.target)!==canonical(target)||proof.nonce!==challenge.nonce||
     (globalThis.location&&proof.origin!==globalThis.location.origin)||!Number.isFinite(proof.expiresAt)||proof.expiresAt<=Date.now())throw new Error('Invalid wallet confirmation. Refresh your messages.');
   await guard();const signature=await wallet.signMessage(challenge.message,account);await guard();
   const result=await post(operation,{nonce:challenge.nonce,signature,...fields});await guard();return result;
  }finally{unsubscribe?.();}
 }
 async function readMany(signalKeys:Hex[]){
  if(!signalKeys.length)return [];
  if(signalKeys.length>20||new Set(signalKeys).size!==signalKeys.length)throw new Error('Open up to 20 messages at a time.');
  const result=await request('read',{signalKeys});
  if(!Array.isArray(result.messages)||result.messages.length!==signalKeys.length)throw new Error('Messages could not be verified.');
  return result.messages.map((row:any,index:number)=>{
   if(row.signalKey!==signalKeys[index]||(row.expiresAt!==null&&(!Number.isFinite(row.expiresAt)||row.expiresAt<=0)))throw new Error('Messages could not be verified.');
   return {signalKey:row.signalKey as Hex,content:validateMemberDraft(row.content),expiresAt:row.expiresAt as number|null};
  });
 }
 return {
  readMany,
  async read(signalKey:Hex){return (await readMany([signalKey]))[0]!;},
  async upload({publicationId,content,retryUncertain=false}:{publicationId:string;content:SignalContent;retryUncertain?:boolean}){
   content=validateMemberDraft(content);const payloadHash=memberContentHash(content);
   const pointer=validateSwarmPointer(await request('upload',{publicationId,payloadHash,retryUncertain},{content}));
   if(pointer.publicationId!==publicationId||pointer.payloadHash!==payloadHash||pointer.source!==content.source)throw new Error('Message upload could not be verified.');return pointer;
  },
 };
}
