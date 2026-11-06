import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFlashFills,createFlashPerformance} from '../../src/features/builder/execution/performance.ts';
const wallet='0x'+'a'.repeat(40);
const asset=(id:string,ticker:string)=>({id,address:id,ticker,chain:{id:'8453',namespace:'eip155',name:'Base'}});
function detail(side='buy',id='buy',qty='2',amount='100',time='2026-11-01T00:00:00Z'){
 return {order:{orderId:id,funderAddress:wallet,recipientAddress:wallet,side,targetAsset:asset('eth','ETH'),contraAsset:asset('usdc','USDC')},fills:[{rootOrderId:id,orderId:id,transactionId:id,status:'CHAIN_STATUS_FINALIZED',filledAt:time,targetAmount:qty,contraAmount:amount,feeNotional:'0.1'}]};
}
test('real results use finalized fills, average cost and separate fees',()=>{
 const buy=detail(),sell=detail('sell','sell','1','70','2026-11-02T00:00:00Z');
 const result=summarizeFlashFills([sell,buy,buy],wallet,true);
 assert.equal(result.markets[0]?.realizedPnl,'20');assert.equal(result.markets[0]?.openQuantity,'1');
 assert.equal(result.feesUsd,'0.2');assert.equal(result.fills,2);
 buy.fills[0]!.status='CHAIN_STATUS_REORGED';
 assert.equal(summarizeFlashFills([buy,sell],wallet,true).markets[0]?.realizedPnl,null);
});
test('missing history, unknown basis and foreign wallets cannot become profits',()=>{
 assert.equal(summarizeFlashFills([detail()],wallet,false).markets[0]?.realizedPnl,null);
 assert.equal(summarizeFlashFills([detail('sell')],wallet,true).markets[0]?.realizedPnl,null);
 const wrong=detail();wrong.order.funderAddress='0x'+'b'.repeat(40);
 assert.throws(()=>summarizeFlashFills([wrong],wallet,true));
 const invalid=detail();invalid.fills[0]!.targetAmount='NaN';assert.throws(()=>summarizeFlashFills([invalid],wallet,true));
});
test('history reader filters wallet, coalesces requests and never submits orders',async()=>{
 const calls:string[]=[];
 const fetcher=async(url:any,init:any)=>{calls.push(String(url));assert.equal(init.method,'GET');return Response.json(String(url).includes('/orders?')?{orders:[{orderId:'buy'}],nextPageToken:null}:detail());};
 const read=createFlashPerformance({fetcher:fetcher as typeof fetch,apiKey:'test',pause:async()=>{}});
 const [a,b]=await Promise.all([read(wallet),read(wallet)]);assert.deepEqual(a,b);
 assert.equal(calls.length,2);assert.match(calls[0]!,/funderAddress=0x/);
 await read(wallet);assert.equal(calls.length,2);
 await assert.rejects(read('invalid'));assert.equal(calls.length,2);
});

test('quote assets and networks stay separate, and incomplete history is explicit',()=>{
 const a=detail();const b=detail('buy','btc','1','5');b.order.contraAsset=asset('usdt','USDT');
 const result=summarizeFlashFills([a,b],wallet,false);
 assert.equal(result.markets.length,2);assert.ok(result.markets.every(row=>row.realizedPnl===null));
});
test('history errors fail closed without caching a false zero',async()=>{
 let calls=0;
 const read=createFlashPerformance({fetcher:async()=>{calls++;return new Response('',{status:503});},apiKey:'test',pause:async()=>{}});
 await assert.rejects(read(wallet));await assert.rejects(read(wallet));assert.equal(calls,2);
});


test('individual finalized transactions expose realized sell profit and loss without inventing buy profit',()=>{
 const buy=detail(),profit=detail('sell','profit','1','70','2026-11-02T00:00:00Z');
 const loss=detail('sell','loss','1','40','2026-11-03T00:00:00Z');
 const result=summarizeFlashFills([loss,profit,buy],wallet,true);
 assert.deepEqual(result.transactions.map(row=>[row.orderId,row.realizedPnl]),[['loss','-10'],['profit','20'],['buy',null]]);
 assert.equal(result.transactions[0]?.feeUsd,'0.1');assert.equal(result.transactions[0]?.transactionId,'loss');
 const partial=summarizeFlashFills([buy,profit],wallet,false);assert.ok(partial.transactions.every(row=>row.realizedPnl===null));
});

test('Solana history is read-only and compares wallet addresses with exact case',async()=>{
 const solana='7YhW8azAFNvE8GqeQ35U5BVB6hDhSfzq5fJRtRixyNbW';
 const row=detail();row.order.funderAddress=solana;row.order.recipientAddress=solana;
 const result=summarizeFlashFills([row],solana,true);assert.equal(result.fills,1);
 assert.throws(()=>summarizeFlashFills([row],solana.toLowerCase()));
 const read=createFlashPerformance({fetcher:async(_url:any,init:any)=>{assert.equal(init.method,'GET');return Response.json({orders:[],nextPageToken:null});},pause:async()=>{}});
 assert.equal((await read(solana)).fills,0);
});
