import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTradeProof} from '../../../src/integrations/arkiv/trade-proofs.ts';
import {generateKeyPairSync,sign} from 'node:crypto';
function base58Encode(bytes:Uint8Array){
 const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),text='';
 while(n){text=alphabet[Number(n%58n)]+text;n/=58n;}for(const byte of bytes){if(byte!==0)break;text='1'+text;}return text;
}
test('Ed25519 source proof binds the exact message and preserves public key case',async()=>{
 const keys=generateKeyPairSync('ed25519'),pub=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32),wallet=base58Encode(pub);
 const signature=base58Encode(sign(null,Buffer.from('bound challenge'),keys.privateKey));
 assert.equal(await verifyTradeProof(wallet,'bound challenge',signature),true);
 assert.equal(await verifyTradeProof(wallet,'another challenge',signature),false);
 assert.equal(await verifyTradeProof(wallet,'bound challenge','bad'),false);
});
