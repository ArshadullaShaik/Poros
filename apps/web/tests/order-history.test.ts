import test from 'node:test';
import assert from 'node:assert/strict';
import {readExecutionRuns,saveExecutionRun,paperTransactions} from '../src/order-history.ts';

const owner='0x'+'a'.repeat(40),other='0x'+'b'.repeat(40);
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};}
const buy={actionId:'buy',side:'BUY',notionalUsd:'20',baseQuantity:'0.01',feeUsd:'0.02',priceUsd:'2000.000000',filledAtMs:1000};
const sell={actionId:'sell',side:'SELL',notionalUsd:'10',baseQuantity:'0.005',feeUsd:'0.01',priceUsd:'2000.000000',filledAtMs:2000};
const snapshot={id:'run',pair:{id:'eth-usdc'},agentMode:'AI',mode:'PAPER',status:'COMPLETED',orders:[buy,sell],liveOrders:[],inference:[{apiKey:'private-inference-key'}],walletRequest:{typedData:'private-signing-payload'},draft:{description:'private-strategy'}};

test('execution receipts preserve fills, isolate wallets and omit keys, drafts and signing data',()=>{
 const store=storage();saveExecutionRun(store,owner,snapshot,3000);
 const records=readExecutionRuns(store,owner);
 assert.equal(records[0]?.agentMode,'AI');assert.equal(records[0]?.orders.length,2);assert.equal(records[0]?.inferenceCount,1);
 assert.deepEqual(readExecutionRuns(store,other),[]);assert.deepEqual(readExecutionRuns(store),[]);
 assert.doesNotMatch([...store.values.values()].join(''),/private-inference-key|private-signing-payload|private-strategy/);
 saveExecutionRun(store,undefined,{...snapshot,id:'guest',agentMode:'RULES_ONLY'},3000);
 assert.equal(readExecutionRuns(store)[0]?.agentMode,'RULES_ONLY');assert.equal(readExecutionRuns(store,owner).length,1);
});

test('paper fill profit and loss use partial position cost and simulated fees',()=>{
 const store=storage();saveExecutionRun(store,owner,snapshot,3000);
 let rows=paperTransactions(readExecutionRuns(store,owner));
 assert.equal(rows[1]?.realizedPnl,null);assert.ok(Math.abs(rows[0]!.realizedPnl!+0.02)<1e-8);
 saveExecutionRun(store,owner,{...snapshot,orders:[buy,{...sell,notionalUsd:'15',priceUsd:'3000.000000',feeUsd:'0.015'}]},4000);
 rows=paperTransactions(readExecutionRuns(store,owner));assert.ok(Math.abs(rows[0]!.realizedPnl!-4.975)<1e-8);
});

test('receipt cache bounds history, rejects corruption and keeps newer snapshots',()=>{
 const store=storage();saveExecutionRun(store,owner,snapshot,4000);
 saveExecutionRun(store,owner,{...snapshot,orders:[]},3000);assert.equal(readExecutionRuns(store,owner)[0]?.orders.length,2);
 for(let index=0;index<105;index++)saveExecutionRun(store,owner,{...snapshot,id:'run-'+index},5000+index);
 assert.equal(readExecutionRuns(store,owner).length,100);assert.equal(readExecutionRuns(store,owner)[0]?.id,'run-104');
 const key=[...store.values.keys()][0]!;
 store.values.set(key,'[null]');assert.throws(()=>readExecutionRuns(store,owner));
 assert.throws(()=>saveExecutionRun(storage(),owner,{...snapshot,pair:{}},3000));
 assert.throws(()=>saveExecutionRun(storage(),owner,{...snapshot,orders:[{...buy,baseQuantity:'-1'}]},3000));
});

test('live receipts require a wallet and never become simulated fills or inferred profits',()=>{
 const store=storage(),solana='11111111111111111111111111111112';
 const live={...snapshot,mode:'LIVE',agentMode:'LIVE',orders:[],liveOrders:[{orderId:'order',side:'BUY',notionalUsd:'20',status:'ORDER_STATUS_PENDING',submittedAtMs:1000}]};
 assert.throws(()=>saveExecutionRun(store,undefined,live,2000));
 saveExecutionRun(store,solana,live,2000);
 assert.equal(readExecutionRuns(store,solana)[0]?.liveOrders.length,1);assert.deepEqual(paperTransactions(readExecutionRuns(store,solana)),[]);
 assert.deepEqual(readExecutionRuns(store,owner),[]);
});
