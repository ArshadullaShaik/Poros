import test from 'node:test';
import assert from 'node:assert/strict';
import {createInjectedWallet} from '../src/wallet.ts';
import type {Hex} from 'viem';

const alice=`0x${'a'.repeat(40)}` as Hex;
test('injected wallet connects and refuses a changed account before a transaction',async()=>{
  let account:Hex|undefined;const calls:string[]=[];
  const provider={request:async({method}:{method:string})=>{calls.push(method);
    if(method==='eth_requestAccounts'){account=alice;return [alice];}
    if(method==='eth_accounts')return account?[account]:[];
    if(method==='eth_chainId')return '0x76edaf';
    if(method==='eth_sendTransaction')return `0x${'1'.repeat(64)}`;
    throw Error(method);}};
  const wallet=createInjectedWallet(provider as never)!;
  await wallet.connect();assert.equal((await wallet.getContext()).account,alice);
  account=undefined;
  await assert.rejects(wallet.sendTransaction({chainId:7794095,to:alice,data:'0x',value:'0x0'},alice),{code:'ACCOUNT_CHANGED'});
  assert.equal(calls.includes('eth_sendTransaction'),false);
});
