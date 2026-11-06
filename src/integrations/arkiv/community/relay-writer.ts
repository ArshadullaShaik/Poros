import {privateKeyToAccount} from 'viem/accounts';
import {createPublicClient,http,keccak256,type Hex} from 'viem';
import {rabdi} from '@arkiv-network/sdk/chains';
import {createArkivEventRepository} from './repository.ts';
export const membershipRelayAddress=(key:Hex)=>privateKeyToAccount(key).address.toLowerCase() as Hex;
export function createMembershipWriter(key:Hex,accessKey:string|undefined,onSigned:(raw:Hex,hash:Hex)=>void){
 const original=privateKeyToAccount(key);
 const signer={...original,async signTransaction(...args:Parameters<typeof original.signTransaction>){
  const raw=await original.signTransaction(...args);onSigned(raw,keccak256(raw));return raw;
 }};
 const chain=rabdi({accessKey:accessKey??''});
 return {address:original.address.toLowerCase() as Hex,events:createArkivEventRepository({signer,accessKey}),client:createPublicClient({chain,transport:http(undefined,{timeout:10000,retryCount:0})})};
}
