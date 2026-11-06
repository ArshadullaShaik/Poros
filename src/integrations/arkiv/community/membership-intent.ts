import {stringToHex,verifyMessage,type Hex} from 'viem';
import {canonical,address,entityKey,requestId,domainHash} from '../codec.ts';
import {fail} from '../errors.ts';
import type {EventDTO} from './contracts.ts';
import {validateSwarmPointer,type SwarmMessagePointer} from './member-content.ts';
export const RABDI_PAYMENT_CHAIN=7794095;
export type MembershipIntent={buyer:Hex;creator:Hex;planKey:Hex;priceWei:string;requestId:string};
export function membershipPaymentData(value:MembershipIntent):Hex{
 address(value.buyer);address(value.creator);entityKey(value.planKey);requestId(value.requestId);
 if(!/^[1-9][0-9]{0,77}$/.test(value.priceWei)||BigInt(value.priceWei)>=2n**256n)fail('INVALID_INPUT');
 return stringToHex(canonical({domain:'poros:membership-payment:1',chainId:RABDI_PAYMENT_CHAIN,buyer:value.buyer,creator:value.creator,planKey:value.planKey,priceWei:value.priceWei,requestId:value.requestId}));
}
export function relayRequestId(kind:string,owner:Hex,id:string){const hash=domainHash('membership-relay',{kind,owner,id}).slice(2,34);return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20)}`;}
export function planChain(plan:Pick<EventDTO,'data'>){return plan.data.chainId===RABDI_PAYMENT_CHAIN?RABDI_PAYMENT_CHAIN:11155111;}
export function planCurrency(plan:Pick<EventDTO,'data'>){return planChain(plan)===RABDI_PAYMENT_CHAIN?'tGLM':'Sepolia ETH';}
export function signalCreator(signal:EventDTO):Hex{return signal.type==='private-signal-relay'?address(signal.data.creator):signal.actor;}
export function signalPointer(signal:EventDTO):SwarmMessagePointer{
 const {format,publicationId,swarmAddress,payloadHash,source}=signal.data;return validateSwarmPointer({format,publicationId,swarmAddress,payloadHash,source});
}
export async function verifySignalAuthor(signal:EventDTO){
 const creator=signalCreator(signal);
 if(signal.source!=='arkiv'||signal.subject!==creator||signal.scope!=='global')fail('UNTRUSTED_RECORD');
 if(signal.type==='private-signal')return creator;
 if(signal.type!=='private-signal-relay')fail('UNTRUSTED_RECORD');
 const pointer=signalPointer(signal),authorization=signal.data.authorization as unknown as {message:string;signature:Hex};
 try{
  const proof=JSON.parse(authorization.message);
  const origin=new URL(proof.origin);
  if(origin.origin!==proof.origin||!['http:','https:'].includes(origin.protocol)||proof.domain!=='poros:member-content:1'||proof.operation!=='publish'||proof.chainId!==RABDI_PAYMENT_CHAIN||proof.wallet!==creator||address(proof.relayActor)!==signal.actor||
    proof.target?.publicationId!==pointer.publicationId||proof.target?.payloadHash!==pointer.payloadHash||typeof proof.target.retryUncertain!=='boolean'||
    !Number.isSafeInteger(proof.issuedAt)||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt-proof.issuedAt!==300000||
    signal.requestId!==relayRequestId('publish',creator,pointer.publicationId))fail('UNTRUSTED_RECORD');
  requestId(proof.nonce);
  if(!await verifyMessage({address:creator,message:authorization.message,signature:authorization.signature}))fail('UNTRUSTED_RECORD');
 }catch{fail('UNTRUSTED_RECORD');}
 return creator;
}
