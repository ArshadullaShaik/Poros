import {verifyMessage,type Hex} from 'viem';
import {createPublicKey,verify} from 'node:crypto';
function decode58(input:string){
 if(typeof input!=='string'||input.length>128)throw new Error('Invalid proof');
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;
 for(const c of input){const i=alphabet.indexOf(c);if(i<0)throw new Error('Invalid proof');n=n*58n+BigInt(i);}
 const bytes:number[]=[];while(n){bytes.unshift(Number(n&255n));n>>=8n;}
 for(const c of input){if(c!=='1')break;bytes.unshift(0);}return Buffer.from(bytes);
}
export async function verifyTradeProof(wallet:string,message:string,signature:string):Promise<boolean>{
 try{
  if(message.length>4096)return false;
  if(/^0x[0-9a-f]{40}$/.test(wallet))return await verifyMessage({address:wallet as Hex,message,signature:signature as Hex});
  const key=decode58(wallet),sig=decode58(signature);if(key.length!==32||sig.length!==64)return false;
  return verify(null,Buffer.from(message),createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),key]),format:'der',type:'spki'}),sig);
 }catch{return false;}
}
