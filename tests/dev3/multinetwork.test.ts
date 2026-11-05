import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tradingPairs,strategyForPair,pairForStrategy,validatePriceStrategy,networks} from '../../src/features/builder/market/config.ts';
import {connectBrowserWallet} from '../../src/features/builder/demo/wallet.js';
test('market registry isolates chains and exposes major assets plus native pairs',()=>{
 assert.ok(tradingPairs.length>40);
 for(const key of ['base','ethereum','bsc','avalanche','polygon','arbitrum','optimism','solana'])assert.ok(tradingPairs.some(pair=>pair.network.key===key),key);
 for(const pair of tradingPairs){const strategy=strategyForPair(pair.id);assert.equal(strategy.networkId,pair.network.id);assert.equal(validatePriceStrategy(strategy).valid,true,pair.id);assert.equal(pairForStrategy(strategy).id,pair.id);}
 const eth=strategyForPair('ethereum-eth-usdc');assert.equal(validatePriceStrategy({...eth,networkId:8453}).valid,false);
 assert.ok(tradingPairs.some(p=>p.base.native&&p.base.reference==='BNB'));
 assert.ok(tradingPairs.some(p=>p.base.reference==='SOL'&&p.network.key==='solana'));
});
test('wallet switches to selected network rather than always Base',async()=>{
 let chain='0x2105';const calls:any[]=[];
 const provider={request:async(call:any)=>{calls.push(call);if(call.method==='eth_requestAccounts')return ['0x1111111111111111111111111111111111111111'];if(call.method==='eth_chainId')return chain;if(call.method==='wallet_switchEthereumChain')chain=call.params[0].chainId;}};
 await connectBrowserWallet(provider,networks.bsc);assert.equal(chain,'0x38');assert.ok(calls.some(c=>c.method==='wallet_switchEthereumChain'));
});

test('native EVM wrapping is exact and bound to the registered wrapped token and selected chain',async()=>{
 const {validateWalletQuote}=await import('../../src/features/builder/execution/flash-orders.ts');
 const pair=pairForStrategy('bsc-native-bnb-usdc'),wallet='0x1111111111111111111111111111111111111111';
 const fields=[{name:'swapper',type:'address'},{name:'vault',type:'address'},{name:'recipient',type:'address'},{name:'fromToken',type:'address'},{name:'toToken',type:'address'},{name:'fromAmount',type:'uint256'},{name:'salt',type:'uint256'},{name:'deadline',type:'uint256'}];
 const typed={primaryType:'FlashOrder',types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}],FlashOrder:fields},domain:{name:'DefinitiveFlashAllowance',version:'1',chainId:'56',verifyingContract:pair.network.settlement},message:{swapper:wallet,recipient:wallet,vault:pair.network.vault,fromToken:pair.base.wrappedAddress,toToken:pair.quote.address,fromAmount:'10000000000000000',salt:'1',deadline:String(Math.floor(Date.now()/1000)+300)}};
 const order={targetChain:'bsc',contraChain:'bsc',targetAsset:pair.base.wrappedAddress,contraAsset:pair.quote.address,side:'sell',qty:'0.010000000000000000',funderAddress:wallet,pairId:pair.id};
 const q={quoteId:'native',targetAsset:order.targetAsset,contraAsset:order.contraAsset,side:'sell',orderType:'market',from:{asset:'target',amount:order.qty},to:{asset:'contra',amount:'6'},evm:{orderTypedData:JSON.stringify(typed),permitTypedData:'',approveTx:null},wrap:{wrappedAsset:pair.base.wrappedAddress,evmTx:{to:pair.base.wrappedAddress,data:'0xd0e30db0',value:'0x2386f26fc10000'}}};
 assert.equal(validateWalletQuote(q,order).networkId,56);
 q.wrap.evmTx.value='0xffffffffffffffff';assert.throws(()=>validateWalletQuote(q,order),/wrapping/);
});

test('Stop during native wrapping confirmation prevents a later approval request',async()=>{
 const {signFlashOrder}=await import('../../src/features/builder/demo/wallet.js');
 const controller=new AbortController(),sent:string[]=[];
 const wallet='0x1111111111111111111111111111111111111111';
 const provider={request:async({method}:any)=>{
  if(method==='eth_accounts')return [wallet];if(method==='eth_chainId')return '0x38';
  if(method==='eth_sendTransaction'){sent.push(method);return '0x'+'1'.repeat(64);}
  if(method==='eth_getTransactionReceipt'){controller.abort();return {status:'0x1'};}
 }};
 await assert.rejects(signFlashOrder({networkId:56,funderAddress:wallet,deadlineMs:Date.now()+300000,wrapTx:{to:'0x1111111111111111111111111111111111111111',data:'0xd0e30db0',value:'0x1'},approveTx:{to:wallet,data:'0x095ea7b3'}},controller.signal,provider));
 assert.equal(sent.length,1);
});
