import assert from 'node:assert/strict';
import {test} from 'node:test';
import {base58Encode,base58Decode,connectSolanaWallet,signSolanaSetup,signSolanaOrderMessage} from '../../src/features/builder/demo/solana-wallet.js';

const publicKey=new Uint8Array(32).fill(7);
const account={address:'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx',publicKey,chains:['solana:mainnet'],features:['solana:signTransaction','solana:signMessage']};
function fixture(){
  const wallet:any={accounts:[account],chains:['solana:mainnet'],features:{
    'standard:connect':{connect:async()=>({accounts:wallet.accounts})},
    'solana:signTransaction':{supportedTransactionVersions:[0,'legacy'],signTransaction:async({transaction}:any)=>[{signedTransaction:transaction}]},
    'solana:signMessage':{signMessage:async({message}:any)=>[{signedMessage:message,signature:new Uint8Array(64).fill(1)}]},
  }};
  return wallet;
}
function transaction(){const bytes=new Uint8Array(70);bytes[0]=1;bytes[65]=0x80;return btoa(String.fromCharCode(...bytes));}
const request=()=>({funderAddress:account.address,deadlineMs:Date.now()+60000,orderMessage:'DFS|m=test|t=1|h=test'});
test('base58 preserves leading zero bytes and rejects invalid characters',()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array([0,0,1,255]),publicKey])assert.deepEqual(base58Decode(base58Encode(bytes)),bytes);
  assert.equal(base58Encode(publicKey),account.address);
  assert.throws(()=>base58Decode('0OIl'));
});
test('Wallet Standard discovery connects and binds a mainnet account',async()=>{
  const surface:any=new EventTarget();const wallet=fixture();
  surface.addEventListener('wallet-standard:app-ready',(event:any)=>event.detail.register(wallet));
  const connected=await connectSolanaWallet({window:surface});
  assert.equal(connected.wallet,wallet);assert.equal(connected.account,account);assert.equal(connected.address,account.address);
  await assert.rejects(connectSolanaWallet({window:new EventTarget()}),/Solana wallet/);
});
test('setup signs raw wire bytes without broadcasting and returns base64',async()=>{
  const wallet=fixture();let calls=0;
  wallet.features['solana:signTransaction'].signTransaction=async(input:any)=>{calls++;assert.equal(input.chain,'solana:mainnet');assert.equal(input.account,account);assert.ok(input.transaction instanceof Uint8Array);const bytes=input.transaction.slice();bytes[1]=4;return [{signedTransaction:bytes}];};
  const signed=await signSolanaSetup(transaction(),account,wallet);
  assert.equal(atob(signed).charCodeAt(1),4);assert.equal(calls,1);
  await assert.rejects(signSolanaSetup('bad!',account,wallet),/transaction/i);
  await assert.rejects(signSolanaSetup(btoa('x'.repeat(1233)),account,wallet),/transaction/i);
  wallet.features['solana:signTransaction'].signTransaction=async({transaction}:any)=>{transaction[69]=1;return [{signedTransaction:transaction}];};
  await assert.rejects(signSolanaSetup(transaction(),account,wallet),/changed/i);
});
test('message signing binds exact bytes, account, expiry and cancellation',async()=>{
  const wallet=fixture();assert.equal((await signSolanaOrderMessage(request(),account,wallet)).length>0,true);
  await assert.rejects(signSolanaOrderMessage({...request(),funderAddress:'wrong'},account,wallet),/changed|account/i);
  await assert.rejects(signSolanaOrderMessage({...request(),deadlineMs:0},account,wallet),/expired/i);
  wallet.features['solana:signMessage'].signMessage=async()=>[{signedMessage:new Uint8Array([1]),signature:new Uint8Array(64)}];
  await assert.rejects(signSolanaOrderMessage(request(),account,wallet),/message/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(signSolanaOrderMessage(request(),account,wallet,controller.signal),/abort/i);
});
test('account changes while signing and malformed signatures are rejected',async()=>{
  const wallet=fixture();wallet.features['solana:signMessage'].signMessage=async({message}:any)=>{wallet.accounts=[];return [{signedMessage:message,signature:new Uint8Array(64)}];};
  await assert.rejects(signSolanaOrderMessage(request(),account,wallet),/changed/i);
  wallet.accounts=[account];wallet.features['solana:signMessage'].signMessage=async({message}:any)=>[{signedMessage:message,signature:new Uint8Array(63)}];
  await assert.rejects(signSolanaOrderMessage(request(),account,wallet),/signature/i);
});
test('devnet accounts and unsupported wire versions cannot sign',async()=>{
  const wallet=fixture();wallet.accounts=[{...account,chains:['solana:devnet']}];
  await assert.rejects(signSolanaSetup(transaction(),account,wallet),/changed/i);
  wallet.accounts=[account];wallet.features['solana:signTransaction'].supportedTransactionVersions=['legacy'];
  await assert.rejects(signSolanaSetup(transaction(),account,wallet),/version/i);
});
