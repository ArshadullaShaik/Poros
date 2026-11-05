import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {buildSolanaSetup,verifySignedSetup,validateSetupInstructions} from '../../src/features/builder/execution/solana-transaction.ts';
import {base58Encode} from '../../src/features/builder/demo/solana-wallet.js';
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const funder=base58Encode(publicKey.export({format:'der',type:'spki'}).subarray(-32));
const address=(n:number)=>base58Encode(new Uint8Array(32).fill(n));
const token='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const meta=(pubkey:string,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const data=Buffer.alloc(9);data[0]=4;data.writeBigUInt64LE(50n,1);
const instruction=()=>({programId:token,accounts:[meta(address(2),false,true),meta(address(3)),meta(funder,true)],data:base58Encode(data)});
const options={funder,mints:[address(4),address(5)],delegate:address(3),maxAmount:'50',inputAccount:address(2)};

test('compile unsigned setup and verify exact message with funder Ed25519 signature',()=>{
 const wire=buildSolanaSetup([instruction()],funder,address(9));const bytes=Buffer.from(wire,'base64');
 assert.equal(bytes[0],1);assert.equal(bytes[65],1);assert.equal(bytes[66],0);assert.equal(bytes[67],2);
 const signature=sign(null,bytes.subarray(65),privateKey);signature.copy(bytes,1);
 assert.equal(verifySignedSetup(wire,bytes.toString('base64'),funder),base58Encode(signature));
 bytes[bytes.length-1]^=1;assert.throws(()=>verifySignedSetup(wire,bytes.toString('base64'),funder),/changed/);
});
test('reject unexpected signers, excessive instructions, unsigned or forged setup',()=>{
 const ix=instruction();ix.accounts[1].isSigner=true;
 assert.throws(()=>buildSolanaSetup([ix],funder,address(9)),/signer/);
 assert.throws(()=>buildSolanaSetup(Array.from({length:17},instruction),funder,address(9)),/instruction/);
 const wire=buildSolanaSetup([instruction()],funder,address(9));assert.throws(()=>verifySignedSetup(wire,wire,funder),/signature/);
 const bytes=Buffer.from(wire,'base64');bytes.fill(1,1,65);assert.throws(()=>verifySignedSetup(wire,bytes.toString('base64'),funder),/signature/);
});
test('allow exact bounded token approval and reject changed delegate, amount or arbitrary program',()=>{
 assert.equal(validateSetupInstructions([instruction()],options).length,1);
 const amount=instruction();const extra=Buffer.from(data);extra.writeBigUInt64LE(51n,1);amount.data=base58Encode(extra);
 for(const ix of [amount,{...instruction(),programId:address(8)},{...instruction(),accounts:[meta(address(2),false,true),meta(address(8)),meta(funder,true)]}])assert.throws(()=>validateSetupInstructions([ix],options));
});
test('native transfer and sync require pinned wrapped SOL account and bounded lamports',()=>{
 const transfer=Buffer.alloc(12);transfer.writeUInt32LE(2);transfer.writeBigUInt64LE(50n,4);
 const native={programId:'11111111111111111111111111111111',accounts:[meta(funder,true,true),meta(address(2),false,true)],data:base58Encode(transfer)};
 const sync={programId:token,accounts:[meta(address(2),false,true)],data:base58Encode(new Uint8Array([17]))};
 assert.equal(validateSetupInstructions([native,sync],{...options,wrappedATA:address(2)}).length,2);
 assert.throws(()=>validateSetupInstructions([native],options));
});
test('ATA creation is idempotent and bound to funder and supported mint',()=>{
 const ix={programId:'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',accounts:[meta(funder,true,true),meta(address(2),false,true),meta(funder),meta(address(4)),meta('11111111111111111111111111111111'),meta(token)],data:base58Encode(new Uint8Array([1]))};
 assert.equal(validateSetupInstructions([ix],options).length,1);
 assert.throws(()=>validateSetupInstructions([{...ix,data:''}],options));
 const wrong=structuredClone(ix);wrong.accounts[2].pubkey=address(8);assert.throws(()=>validateSetupInstructions([wrong],options));
});
test('checked approval binds mint and total native transfers stay bounded',()=>{
 const bytes=Buffer.alloc(10);bytes[0]=13;bytes.writeBigUInt64LE(50n,1);bytes[9]=6;
 const checked={programId:token,accounts:[meta(address(2),false,true),meta(address(4)),meta(address(3)),meta(funder,true)],data:base58Encode(bytes)};
 assert.equal(validateSetupInstructions([checked],options).length,1);
 checked.accounts[1].pubkey=address(8);assert.throws(()=>validateSetupInstructions([checked],options));
 const transfer=Buffer.alloc(12);transfer.writeUInt32LE(2);transfer.writeBigUInt64LE(30n,4);
 const ix={programId:'11111111111111111111111111111111',accounts:[meta(funder,true,true),meta(address(2),false,true)],data:base58Encode(transfer)};
 assert.throws(()=>validateSetupInstructions([ix,ix],{...options,wrappedATA:address(2)}));
});
test('derive the canonical classic-token ATA with PDA off-curve bump search',async()=>{
 const {associatedTokenAddress}=await import('../../src/features/builder/execution/solana-transaction.ts');
 assert.equal(associatedTokenAddress('11111111111111111111111111111111','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),'HJt8Tjdsc9ms9i4WCZEzhzr4oyf3ANcdzXrNdLPFqm3M');
 assert.throws(()=>associatedTokenAddress('invalid','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'));
 assert.throws(()=>associatedTokenAddress('11111111111111111111111111111111','1'));
});
test('reject SPL Transfer opcode 3 even with approval-shaped accounts',()=>{
 const transfer=instruction();const bytes=Buffer.from(data);bytes[0]=3;transfer.data=base58Encode(bytes);
 assert.throws(()=>validateSetupInstructions([transfer],options),/unsafe|Unsupported/);
});
