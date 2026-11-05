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

test('unknown Rabdi network is added with official metadata and verified after switching', async () => {
  let chain = '0x1';
  let added = false;
  const calls: string[] = [];
  const provider = {request: async ({method, params}: {method: string; params?: unknown[]}) => {
    calls.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') {
      if (!added) throw Object.assign(new Error('Unknown chain'), {code: 4902});
      chain = '0x76edaf';
      return null;
    }
    if (method === 'wallet_addEthereumChain') {
      assert.deepEqual(params, [{chainId: '0x76edaf', chainName: 'Rabdi',
        nativeCurrency: {name: 'Golem', symbol: 'tGLM', decimals: 18},
        rpcUrls: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
        blockExplorerUrls: ['https://rabdi.explorer.arkiv.network']}]);
      added = true;
      return null;
    }
    throw Error(method);
  }};
  await createInjectedWallet(provider)!.switchChain!(7794095);
  assert.equal(chain, '0x76edaf');
  assert.equal(calls.filter(method => method === 'wallet_switchEthereumChain').length, 2);
  assert.equal(calls.includes('eth_sendTransaction'), false);
});

test('rejected network switches never attempt to add a network or send a transaction', async () => {
  const calls: string[] = [];
  const provider = {request: async ({method}: {method: string}) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0x1';
    throw Object.assign(new Error('Rejected'), {code: 4001});
  }};
  await assert.rejects(createInjectedWallet(provider)!.switchChain!(7794095), {code: 4001});
  assert.deepEqual(calls, ['eth_chainId', 'wallet_switchEthereumChain']);
});

test('a wallet that stays on the wrong network cannot report a successful switch or send', async () => {
  const calls: string[] = [];
  const provider = {request: async ({method}: {method: string}) => {
    calls.push(method);
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_accounts') return [alice];
    if (method === 'wallet_switchEthereumChain') return null;
    throw Error(method);
  }};
  const wallet = createInjectedWallet(provider)!;
  await assert.rejects(wallet.switchChain!(7794095), {code: 'WRONG_CHAIN'});
  await assert.rejects(wallet.sendTransaction({chainId: 7794095, to: alice, data: '0x', value: '0x0'}, alice), {code: 'WRONG_CHAIN'});
  assert.equal(calls.includes('eth_sendTransaction'), false);
});

test('a rejected account connection propagates and missing providers stay unavailable', async () => {
  assert.equal(createInjectedWallet(undefined), undefined);
  const provider = {request: async () => {throw Object.assign(new Error('Rejected'), {code: 4001});}};
  await assert.rejects(createInjectedWallet(provider)!.connect(), {code: 4001});
});


test('simultaneous network requests share one MetaMask prompt', async () => {
  let chain = '0x1', switches = 0;
  const wallet = createInjectedWallet({request:async ({method,params}) => {
    if(method === 'eth_chainId') return chain;
    if(method === 'wallet_switchEthereumChain') {
      switches++;
      await new Promise(resolve=>setTimeout(resolve,5));
      chain = (params![0] as {chainId:string}).chainId;
      return null;
    }
    throw new Error(method);
  }})!;
  await Promise.all([wallet.switchChain!(7794095),wallet.switchChain!(7794095)]);
  assert.equal(switches,1);
  await wallet.switchChain!(7794095);
  assert.equal(switches,1);
  await wallet.switchChain!(11155111);
  assert.equal(switches,2);
});
