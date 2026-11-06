import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorReport,creatorVersions} from '../src/creator-report.ts';
const fill={orderId:'one',transactionId:'tx',market:'ETH / USDC',chain:'Ethereum',currency:'USDC',side:'SELL',quantity:'1',value:'12',feeUsd:'0.1',filledAt:1700000000000,realizedPnl:'2'};
const report={complete:true,fills:3,feesUsd:'0.3',markets:[{market:fill.market,chain:fill.chain,currency:'USDC',realizedPnl:'1',openQuantity:'0',sells:3}],transactions:[fill,{...fill,realizedPnl:'-1'},{...fill,realizedPnl:'0'}]};
test('report derives sell-fill wins and profit factor, never portfolio returns',()=>{
 const html=creatorReport(report);
 assert.match(html,/33.3%/);assert.match(html,/2.00/);assert.match(html,/0.3 USD/);
 assert.match(html,/Total return.*Unavailable/s);assert.match(html,/Drawdown.*Unavailable/s);assert.match(html,/Benchmark.*Unavailable/s);
 assert.match(html,/before separate USD fees/);
});
test('incomplete or missing basis withholds fill statistics and profit',()=>{
 const html=creatorReport({...report,complete:false});
 assert.doesNotMatch(html,/33.3%|2.00/);assert.match(html,/History incomplete/);
 const missing=creatorReport({...report,transactions:[{...fill,realizedPnl:null}],fills:1});
 assert.match(missing,/Cost basis missing/);assert.doesNotMatch(missing,/33.3%|2.00/);
});
test('report rejects malformed results and escapes public fields',()=>{
 assert.throws(()=>creatorReport({...report,feesUsd:'NaN'}));
 assert.throws(()=>creatorReport({...report,fills:4}));
 const html=creatorReport({...report,transactions:report.transactions.map(row=>({...row,market:'<img src=x onerror=alert(1)>'}))});
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('version history links exact builder version and marks unavailable lineage',()=>{
 const key='0x'+'a'.repeat(64);
 const html=creatorVersions([{versionKey:key,parentVersionKey:key,lineageStatus:'missing-ancestor',expiresAtBlock:'123',document:{name:'<script>'}}] as any,false);
 assert.match(html,new RegExp('/\\?strategy='+key));assert.match(html,/Incomplete history/);assert.match(html,/Missing ancestor/);assert.match(html,/Expiry block 123/);assert.doesNotMatch(html,/<script>/);
});
