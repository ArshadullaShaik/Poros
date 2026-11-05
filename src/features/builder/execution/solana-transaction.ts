import {createHash,createPublicKey,verify} from 'node:crypto';
import {base58Encode,base58Decode} from '../demo/solana-wallet.js';

type Meta={pubkey:string;isSigner:boolean;isWritable:boolean};
type Instruction={programId:string;accounts:Meta[];data:string};
const SYSTEM='11111111111111111111111111111111';
const TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
function key(value:string){const bytes=base58Decode(value);if(bytes.length!==32)throw new Error('Invalid Solana public key');return bytes;}
const FIELD=(1n<<255n)-19n;
function mod(value:bigint){return (value%FIELD+FIELD)%FIELD;}
function power(value:bigint,exponent:bigint){let result=1n;for(value=mod(value);exponent;exponent>>=1n,value=mod(value*value))if(exponent&1n)result=mod(result*value);return result;}
const EDWARDS_D=mod(-121665n*power(121666n,FIELD-2n));
function onCurve(bytes:Uint8Array){
 let y=0n;for(let i=31;i>=0;i--)y=(y<<8n)+BigInt(i===31?bytes[i]&127:bytes[i]);
 if(y>=FIELD)return false;
 const ySquared=mod(y*y),denominator=mod(EDWARDS_D*ySquared+1n);
 if(!denominator)return false;
 const xSquared=mod((ySquared-1n)*power(denominator,FIELD-2n));
 return xSquared===0n||power(xSquared,(FIELD-1n)/2n)===1n;
}
export function associatedTokenAddress(owner:string,mint:string):string{
 const seeds=[key(owner),key(TOKEN),key(mint)],program=key(ATA);
 for(let bump=255;bump>=0;bump--){
  const hash=createHash('sha256').update(Buffer.concat([...seeds.map(seed=>Buffer.from(seed)),Buffer.from([bump]),Buffer.from(program),Buffer.from('ProgramDerivedAddress')])).digest();
  if(!onCurve(hash))return base58Encode(hash);
 }
 throw new Error('Unable to derive Solana associated token account');
}
function instructions(value:Instruction[]){
 if(!Array.isArray(value)||!value.length||value.length>16)throw new Error('Invalid Solana setup instruction count');
 for(const ix of value){key(ix.programId);if(!Array.isArray(ix.accounts)||ix.accounts.length>32)throw new Error('Invalid instruction accounts');for(const a of ix.accounts){key(a.pubkey);if(typeof a.isSigner!=='boolean'||typeof a.isWritable!=='boolean')throw new Error('Invalid account flags');}if(typeof ix.data!=='string'||ix.data.length>1700)throw new Error('Invalid instruction data');base58Decode(ix.data);}
}
function compact(n:number){const bytes=[];do{let byte=n&127;n>>>=7;if(n)byte|=128;bytes.push(byte);}while(n);return Buffer.from(bytes);}
export function buildSolanaSetup(ixs:Instruction[],funder:string,blockhash:string):string{
 instructions(ixs);key(funder);key(blockhash);
 const accounts=new Map<string,Meta>([[funder,{pubkey:funder,isSigner:true,isWritable:true}]]);
 const add=(a:Meta)=>{if(a.isSigner&&a.pubkey!==funder)throw new Error('Unexpected Solana setup signer');const old=accounts.get(a.pubkey);accounts.set(a.pubkey,{...a,isSigner:a.isSigner||!!old?.isSigner,isWritable:a.isWritable||!!old?.isWritable});};
 for(const ix of ixs){ix.accounts.forEach(add);add({pubkey:ix.programId,isSigner:false,isWritable:false});}
 if(accounts.size>32)throw new Error('Too many Solana setup accounts');
 const ordered=[...accounts.values()].sort((a,b)=>Number(b.isSigner)-Number(a.isSigner)||Number(b.isWritable)-Number(a.isWritable));
 const index=(address:string)=>ordered.findIndex(a=>a.pubkey===address);
 const compiled=ixs.map(ix=>Buffer.concat([Buffer.from([index(ix.programId)]),compact(ix.accounts.length),Buffer.from(ix.accounts.map(a=>index(a.pubkey))),compact(base58Decode(ix.data).length),Buffer.from(base58Decode(ix.data))]));
 const message=Buffer.concat([Buffer.from([1,0,ordered.filter(a=>!a.isSigner&&!a.isWritable).length]),compact(ordered.length),...ordered.map(a=>Buffer.from(key(a.pubkey))),Buffer.from(key(blockhash)),compact(compiled.length),...compiled]);
 const wire=Buffer.concat([Buffer.from([1]),Buffer.alloc(64),message]);if(wire.length>1232)throw new Error('Solana setup transaction exceeds 1232 bytes');return wire.toString('base64');
}
function wire(text:string){if(typeof text!=='string'||!text.length||text.length>1644||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('Invalid setup transaction encoding');const bytes=Buffer.from(text,'base64');if(bytes.length<101||bytes.length>1232||bytes[0]!==1||bytes[65]!==1||bytes[66]!==0)throw new Error('Invalid setup transaction');return bytes;}
export function verifySignedSetup(originalBase64:string,signedBase64:string,funder:string):string{
 const original=wire(originalBase64),signed=wire(signedBase64);
 if(!original.subarray(65).equals(signed.subarray(65)))throw new Error('Signed setup transaction message changed');
 if(!original.subarray(69,101).equals(Buffer.from(key(funder))))throw new Error('Setup funder changed');
 const signature=signed.subarray(1,65);const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(key(funder))]),format:'der',type:'spki'});
 if(signature.every(byte=>byte===0)||!verify(null,signed.subarray(65),publicKey,signature))throw new Error('Invalid Solana setup signature');return base58Encode(signature);
}
export function validateSetupInstructions(ixs:Instruction[],options:{funder:string;mints:string[];delegate:string;maxAmount:string|bigint;inputAccount?:string;wrappedATA?:string}):Instruction[]{
 instructions(ixs);const {funder,mints,delegate,inputAccount,wrappedATA}=options;key(funder);key(delegate);mints.forEach(key);if(inputAccount)key(inputAccount);if(wrappedATA)key(wrappedATA);
 const max=BigInt(options.maxAmount);if(max<=0n||max>18446744073709551615n)throw new Error('Invalid setup allowance');
 const require=(ok:boolean)=>{if(!ok)throw new Error('Unsupported or unsafe Solana setup instruction');};
 let transferred=0n;
 for(const ix of ixs){
  const data=Buffer.from(base58Decode(ix.data)),a=ix.accounts;
  require(a.every(account=>!account.isSigner||account.pubkey===funder));
  if(ix.programId===TOKEN||ix.programId===TOKEN2022){
   if(data[0]===4||data[0]===13){const checked=data[0]===13;require(data.length===(checked?10:9)&&a.length===(checked?4:3));const amount=data.readBigUInt64LE(1);const authority=a[checked?3:2],delegateAccount=a[checked?2:1];require(amount>0n&&amount<=max&&a[0].isWritable&&(!inputAccount||a[0].pubkey===inputAccount)&&authority.pubkey===funder&&authority.isSigner&&delegateAccount.pubkey===delegate&&(!checked||mints.includes(a[1].pubkey)));}
   else if(data[0]===17)require(data.length===1&&a.length===1&&!!wrappedATA&&a[0].pubkey===wrappedATA&&a[0].isWritable&&ix.programId===TOKEN);
   else require(false);
  }else if(ix.programId===ATA){
   require(data.length===1&&data[0]===1&&a.length===6&&a[0].pubkey===funder&&a[0].isSigner&&a[0].isWritable&&a[1].isWritable&&a[2].pubkey===funder&&mints.includes(a[3].pubkey)&&a[4].pubkey===SYSTEM&&(a[5].pubkey===TOKEN||a[5].pubkey===TOKEN2022));
  }else if(ix.programId===SYSTEM){
   require(data.length===12&&data.readUInt32LE(0)===2&&a.length===2&&a[0].pubkey===funder&&a[0].isSigner&&a[0].isWritable&&!!wrappedATA&&a[1].pubkey===wrappedATA&&a[1].isWritable);
   transferred+=data.readBigUInt64LE(4);require(transferred<=max);
  }else require(false);
 }
 return ixs;
}
