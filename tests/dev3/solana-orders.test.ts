import assert from 'node:assert/strict';
import {test} from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {associatedTokenAddress} from '../../src/features/builder/execution/solana-transaction.ts';
import {createSolanaOrders} from '../../src/features/builder/execution/solana-orders.ts';
import {base58Encode} from '../../src/features/builder/demo/solana-wallet.js';
import {pairForStrategy} from '../../src/features/builder/market/config.ts';
test('Solana quote and signature stay bound to captured amount, message and mints',async()=>{
 const keys=generateKeyPairSync('ed25519'),wallet=base58Encode(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32)),pair=pairForStrategy('solana-sol-usdc');let posts=0,body:any;
 const fetcher=async(url:any,init:any)=>{const req=JSON.parse(init.body);if(req.method==="getGenesisHash")return Response.json({jsonrpc:"2.0",id:1,result:"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"});if(!String(url).includes('flash'))return Response.json({jsonrpc:'2.0',id:1,result:{value:[{pubkey:associatedTokenAddress(wallet,pair.quote.address),account:{data:{parsed:{info:{owner:wallet,mint:pair.quote.address,tokenAmount:{amount:'100000000'}}}}}}]}});
 if(String(url).endsWith('/order')){posts++;body=req;return Response.json({orderId:'solana-order'});}
 return Response.json({quoteId:'solana-quote',targetAsset:pair.base.address,contraAsset:pair.quote.address,side:'buy',orderType:'market',from:{asset:'contra',amount:req.qty},to:{asset:'target',amount:'0.2'},svm:{orderMessage:`DFS|m=${pair.quote.address}|t=20000000|h=1111111111111111`,nonce:'1',deadline:String(Math.floor(Date.now()/1000)+300),delegateIx:null,ataSetupIxs:null,sponsoredDelegateTx:null},evm:null,wrap:null});};
 const orders=createSolanaOrders({fetcher});const prepared=await orders.prepare({action:{side:'BUY',notionalUsd:20},condition:{minPriceUsd:90,maxPriceUsd:110},funderAddress:wallet,priceUsd:'100.000000',quotePriceUsd:'1.000000',maxSlippageBps:50,pairId:pair.id});
 assert.equal(prepared.family,'solana');assert.equal(prepared.setupTxs.length,0);
 await assert.rejects(orders.submit(prepared,base58Encode(new Uint8Array(64))),/signature/);assert.equal(posts,0);
 const signature=base58Encode(sign(null,Buffer.from(prepared.orderMessage),keys.privateKey));assert.equal(await orders.submit(prepared,signature),'solana-order');assert.equal(posts,1);assert.equal(body.svmNonce,'1');assert.equal(body.evmOrderTypedData,undefined);
});

test('Solana rejects another cluster before reading balances or requesting a quote',async()=>{
 let calls=0;
 const orders=createSolanaOrders({fetcher:async()=>{calls++;return Response.json({jsonrpc:'2.0',id:1,result:'devnet-genesis'});}});
 await assert.rejects(orders.prepare({pairId:'solana-sol-usdc',action:{side:'BUY',notionalUsd:20},funderAddress:'11111111111111111111111111111111',priceUsd:'100',quotePriceUsd:'1',maxSlippageBps:50,condition:{minPriceUsd:90,maxPriceUsd:110}}),/mainnet-beta/);
 assert.equal(calls,1);
});
