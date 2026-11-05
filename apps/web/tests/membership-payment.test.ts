import test from 'node:test';
import assert from 'node:assert/strict';
import type { Hex } from 'viem';
import type { WalletBridge } from '../src/integration.ts';
import { readMembershipPayment, sendMembershipPayment, type MembershipPayment } from '../src/membership-payment.ts';

const buyer = ('0x'+'a'.repeat(40)) as Hex, creator = ('0x'+'b'.repeat(40)) as Hex;
const hash = ('0x'+'1'.repeat(64)) as Hex;
const payment: MembershipPayment = {buyer,creator,planKey:hash,keyRecord:hash,priceWei:'100000000000000',requestId:crypto.randomUUID(),attempted:false};
function setup(send:()=>Promise<Hex> = async()=>hash) {
  const records = new Map<string,string>();
  const storage = {getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);},removeItem:(key:string)=>{records.delete(key);}};
  let account = buyer, sends = 0;
  const provider = {request:async()=> '0xaa36a7'};
  const wallet = {getContext:async()=>({account,provider}),switchChain:async()=>{},sendTransaction:async(transaction:unknown)=>{
    assert.deepEqual(transaction,{chainId:11155111,to:creator,data:'0x',value:'0x5af3107a4000'});
    assert.equal(readMembershipPayment(storage,buyer)?.attempted,true);
    sends++;return send();
  }} as unknown as WalletBridge;
  let held = false;
  const locks = {request:async(_name:string,_options:unknown,callback:(lock:object|null)=>Promise<unknown>)=>{
    if(held)return callback(null);held=true;try{return await callback({});}finally{held=false;}
  }} as LockManager;
  return {storage,wallet,locks,sends:()=>sends,changeAccount:()=>{account=creator;}};
}
test('native membership payment persists intent before send and blocks retry after success or uncertainty',async()=>{
  for (const send of [async()=>hash,async()=>{throw new Error('Disconnected after send');}]) {
    const env=setup(send);
    await sendMembershipPayment(env.wallet,payment,env.storage,async()=>{},env.locks).catch(()=>{});
    assert.equal(readMembershipPayment(env.storage,buyer)?.attempted,true);
    await assert.rejects(sendMembershipPayment(env.wallet,payment,env.storage,async()=>{},env.locks));
    assert.equal(env.sends(),1);
  }
});
test('changed account, failed preflight and unavailable recovery storage prevent payment',async()=>{
  const env=setup();
  await assert.rejects(sendMembershipPayment(env.wallet,payment,env.storage,async()=>{env.changeAccount();},env.locks));
  assert.equal(env.sends(),0);
  const other=setup();
  await assert.rejects(sendMembershipPayment(other.wallet,payment,other.storage,async()=>{throw Error('Price changed');},other.locks));
  const broken={...other.storage,setItem:()=>{throw Error('Storage blocked');}};
  await assert.rejects(sendMembershipPayment(other.wallet,payment,broken,async()=>{},other.locks));
  assert.equal(other.sends(),0);
});
test('a wallet rejection clears only a known unsubmitted payment',async()=>{
  const env=setup(async()=>{throw Object.assign(new Error('Rejected'),{code:4001});});
  await assert.rejects(sendMembershipPayment(env.wallet,payment,env.storage,async()=>{},env.locks));
  assert.equal(readMembershipPayment(env.storage,buyer),undefined);
});

test('storage failure after broadcast preserves uncertainty and prevents a second payment',async()=>{
  const env=setup();
  let writes=0;
  const storage={...env.storage,setItem:(key:string,value:string)=>{
    writes++;
    if(writes===2)throw Error('Storage became unavailable');
    env.storage.setItem(key,value);
  }};
  await assert.rejects(sendMembershipPayment(env.wallet,payment,storage,async()=>{},env.locks));
  assert.equal(readMembershipPayment(env.storage,buyer)?.attempted,true);
  await assert.rejects(sendMembershipPayment(env.wallet,payment,env.storage,async()=>{},env.locks));
  assert.equal(env.sends(),1);
});
