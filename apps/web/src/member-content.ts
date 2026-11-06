import type {Hex} from 'viem';
import type {WalletBridge} from './integration.ts';
import type {EventDTO} from '../../../src/integrations/arkiv/community/contracts.ts';
import type {MembershipPayment} from './membership-payment.ts';
import {verifySignalAuthor,relayRequestId} from '../../../src/integrations/arkiv/community/membership-intent.ts';
import type {SignalContent} from '../../../src/integrations/arkiv/community/memberships.ts';
import {canonical} from '../../../src/integrations/arkiv/codec.ts';
import {validateMemberContent,memberContentHash,validateSwarmPointer} from '../../../src/integrations/arkiv/community/member-content.ts';
import {validatePriceStrategy} from '../../../src/features/builder/market/config.ts';

export const validateMemberDraft=(value:unknown)=>validateMemberContent(value,input=>{const result=validatePriceStrategy(input);return result.valid&&result.strategy.riskPolicy.paperTradingOnly;});
export function createMemberContentClient({wallet,fetcher=fetch}:{wallet:WalletBridge;fetcher?:typeof fetch}){
 async function post(path:string,body:unknown){
   const response=await fetcher('/api/member-content/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(120000)});
   const result=await response.json();if(!response.ok||!result.ok)throw Object.assign(new Error(result.error?.message??'Messages are unavailable. Try again.'),{code:result.error?.code});return result.data;
  }
 async function request(operation:'upload'|'read'|'publish',target:Record<string,unknown>,fields:Record<string,unknown>={}){
  const original=await wallet.getContext(),account=original.account.toLowerCase() as Hex;
  let changed=false;const unsubscribe=wallet.subscribe?.(()=>{changed=true;});
  async function guard(){const current=await wallet.getContext();if(changed||current.account.toLowerCase()!==account||current.provider!==original.provider)throw new Error('Wallet account changed. Refresh your messages.');}
  try{
   const challenge=await post('challenge',{wallet:account,operation,target});
   const proof=JSON.parse(challenge.message);
   if(proof.domain!=='poros:member-content:1'||proof.wallet!==account||proof.operation!==operation||canonical(proof.target)!==canonical(target)||proof.nonce!==challenge.nonce||
     (globalThis.location&&proof.origin!==globalThis.location.origin)||!Number.isFinite(proof.expiresAt)||proof.expiresAt<=Date.now())throw new Error('Invalid wallet confirmation. Refresh your messages.');
   if(operation==='publish'&&(proof.chainId!==7794095||!/^0x[0-9a-f]{40}$/.test(proof.relayActor??'')||typeof proof.purpose!=='string'))throw new Error('Invalid publication authorization.');
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
 async function completed(kind:'publish'|'purchase',owner:Hex,id:string,job:any){
  for(let tries=0;tries<40;tries++){
   if(job?.phase==='done')return job.result as EventDTO;
   if(job?.error==='UPLOAD_UNCERTAIN')throw Object.assign(new Error('The Swarm upload is uncertain. Use Retry upload to authorize another storage upload.'),{code:'UPLOAD_UNCERTAIN'});
   await new Promise(resolve=>setTimeout(resolve,1500));
   job=await post('status',{kind,owner,id});
  }
  throw Object.assign(new Error('Processing is still in progress. Your original request is saved; use Refresh membership to check it.'),{code:'WRITE_STATUS_UNKNOWN'});
 }
 return {
  readMany,
  ready:()=>post('status',{ready:true}),
  async activate(payment:MembershipPayment){
   let job=await post('status',{kind:'purchase',owner:payment.buyer,id:payment.requestId});
   if(!job){
    for(let tries=0;tries<40;tries++){
     try{job=await post('activate',{buyer:payment.buyer,creator:payment.creator,planKey:payment.planKey,priceWei:payment.priceWei,requestId:payment.requestId,hash:payment.hash});break;}
     catch(error){if((error as any).code!=='PAYMENT_UNVERIFIED')throw error;if(tries===39)throw error;await new Promise(resolve=>setTimeout(resolve,1500));}
    }
   }
   const result=await completed('purchase',payment.buyer,payment.requestId,job);
   if(result.type!=='subscription-relay'||result.subject!==payment.buyer||result.scope!==payment.creator||result.data.planKey!==payment.planKey||result.data.transactionHash!==payment.hash||result.data.purchaseId!==payment.requestId)throw new Error('Membership activation could not be verified.');
   return result;
  },
  async publish({publicationId,content,retryUncertain=false}:{publicationId:string;content:SignalContent;retryUncertain?:boolean}){
   content=validateMemberDraft(content);const owner=(await wallet.getContext()).account.toLowerCase() as Hex;
   let job=await post('status',{kind:'publish',owner,id:publicationId});
   if(!job||(retryUncertain&&job.error==='UPLOAD_UNCERTAIN'))job=await request('publish',{publicationId,payloadHash:memberContentHash(content),retryUncertain},{content});
   const result=await completed('publish',owner,publicationId,job);
   if(await verifySignalAuthor(result)!==owner||result.requestId!==relayRequestId('publish',owner,publicationId)||result.data.payloadHash!==memberContentHash(content))throw new Error('Publication could not be verified.');
   return result;
  },
  async read(signalKey:Hex){return (await readMany([signalKey]))[0]!;},
  async upload({publicationId,content,retryUncertain=false}:{publicationId:string;content:SignalContent;retryUncertain?:boolean}){
   content=validateMemberDraft(content);const payloadHash=memberContentHash(content);
   const pointer=validateSwarmPointer(await request('upload',{publicationId,payloadHash,retryUncertain},{content}));
   if(pointer.publicationId!==publicationId||pointer.payloadHash!==payloadHash||pointer.source!==content.source)throw new Error('Message upload could not be verified.');return pointer;
  },
 };
}
