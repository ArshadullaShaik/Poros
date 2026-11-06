import test from 'node:test';
import assert from 'node:assert/strict';
import {readTradeReport} from '../src/trade-history.ts';
import {creatorReport} from '../src/creator-report.ts';
import {ledgerOrderRows} from '../src/order-history.ts';
test('trade history refuses an ordinary Flash response mislabeled as an Arkiv track record',async()=>{
 await assert.rejects(readTradeReport('0x'+'a'.repeat(40),undefined,async()=>Response.json({ok:true,data:{complete:true,fills:0,transactions:[],markets:[]}})));
});
test('pending and cancelled Arkiv orders remain visible without any browser receipts or finalized fills',()=>{
 const order={source:{kind:'flash',sourceId:'flash:wallet',wallet:'wallet',chainFamily:'evm'},data:{orderId:'pending',status:'ORDER_STATUS_PENDING',market:'ETH / USDC',chain:'Base',currency:'USDC',side:'BUY'},observedAt:1000,entityKey:'0x'+'1'.repeat(64)};
 const rows=ledgerOrderRows([order] as any,[]);assert.equal(rows.length,1);assert.equal(rows[0]!.market,'ETH / USDC');assert.match(rows[0]!.status,/pending/);assert.equal(rows[0]!.quantity,null);
 const html=creatorReport({provenance:'arkiv',complete:true,fills:0,feesUsd:'0',markets:[],transactions:[],orders:[order]});assert.match(html,/Recorded order activity/);assert.match(html,/pending/);
});
test('verified ledger reports identify Arkiv provenance and show unknown fees without fabricating zero',()=>{
 const html=creatorReport({provenance:'arkiv',complete:false,fills:1,feesUsd:'0',feesComplete:false,markets:[{market:'ETH / USDC',chain:'Base',currency:'USDC',realizedPnl:null}],transactions:[{orderId:'order',transactionId:'tx',market:'ETH / USDC',chain:'Base',currency:'USDC',side:'BUY',quantity:'1',value:'2000',feeUsd:null,filledAt:1000,realizedPnl:null}]});
 assert.match(html,/Arkiv/);assert.match(html,/Unknown/);assert.doesNotMatch(html,/up to 50 recent Flash orders/);
});
