import test from 'node:test';
import assert from 'node:assert/strict';
import {openTradeState} from '../../src/features/builder/server/trade-state.ts';
import {createTradeLedger} from '../../src/features/builder/server/trade-ledger.ts';
import {normalizeTradeOrder} from '../../src/features/builder/execution/trade-source.ts';
import {detail,source,trader,repository} from './trade-fixtures.ts';
test('reconciliation survives lost inclusion responses, duplicate pages and provider outages',async()=>{
 const state=openTradeState(':memory:'),repo=repository();let fail=false;
 state.link({trader,source,linkedAt:1000,historicalFrom:null});
 const ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:{async validateBinding(){},async page(){if(fail)throw new Error('offline');return {orders:[normalizeTradeOrder(detail(),source)],nextCursor:null,observedAt:2000};},async order(){return normalizeTradeOrder(detail(),source);}},now:()=>2000});
 repo.loseResponse=true;await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
 await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
 assert.equal(repo.entries.filter(e=>e.kind==='fill').length,1);
 assert.equal(state.outbox().length,0);
 fail=true;await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
 assert.ok(state.sources()[0]!.lastError);assert.equal(repo.entries.filter(e=>e.kind==='fill').length,1);state.close();
});
test('unlinked source orders continue to reconcile without discovering new unrelated activity',async()=>{
 const state=openTradeState(':memory:'),repo=repository();state.link({trader,source,linkedAt:1000,historicalFrom:null});
 state.trackOrder({trader,source,runId:'run',actionId:'action',quoteId:'quote',orderId:'buy',createdAt:1000});state.unlink(source,trader,1500);
 let pages=0,orders=0;
 const ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:{async validateBinding(){},async page(){pages++;return {orders:[],nextCursor:null,observedAt:2000};},async order(){orders++;return normalizeTradeOrder(detail(),source);}},now:()=>2000});
 await ledger.runOnce(AbortSignal.timeout(1000));assert.equal(pages,0);assert.equal(orders,1);assert.equal(repo.entries.filter(e=>e.kind==='fill').length,1);state.close();
});

test('missing previously confirmed entities leave an explicit renewal gap',async()=>{
 const state=openTradeState(':memory:'),repo=repository();state.link({trader,source,linkedAt:1000,historicalFrom:null});
 const ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:{async validateBinding(){},async page(){return {orders:[normalizeTradeOrder(detail(),source)],nextCursor:null,observedAt:2000};},async order(){return normalizeTradeOrder(detail(),source);}},now:()=>2000});
 await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));repo.entries.splice(0,1);
 await ledger.renewDue(AbortSignal.timeout(1000));assert.ok(state.meta('renewalError'));state.close();
});
test('a formerly finalized fill disappearing from provider evidence is disputed instead of silently retained as verified',async()=>{
 const state=openTradeState(':memory:'),repo=repository();state.link({trader,source,linkedAt:1000,historicalFrom:null});let reorg=false;
 const adapter={async validateBinding(){},async page(){const row=detail();if(reorg)row.fills[0]!.status='CHAIN_STATUS_REORGED';return {orders:[normalizeTradeOrder(row,source)],nextCursor:null,observedAt:2000};},async order(){return normalizeTradeOrder(detail(),source);}};
 const ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:adapter,now:()=>2000});
 await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));reorg=true;
 await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
 assert.equal(repo.entries.filter(e=>e.kind==='dispute').length,1);assert.ok(state.sources()[0]!.coverage?.disputed);state.close();
});
test('an unlinked submitted order retries after an outage instead of being stranded by its error flag',async()=>{
 const state=openTradeState(':memory:'),repo=repository();let time=2000,fail=true,calls=0;state.link({trader,source,linkedAt:1000,historicalFrom:null});
 state.trackOrder({trader,source,runId:'r',actionId:'a',quoteId:'q',orderId:'buy',createdAt:1000});state.unlink(source,trader,1500);
 const ledger=createTradeLedger({state,repository:repo as any,now:()=>time,sourceAdapter:{async validateBinding(){},async page(){return {orders:[],nextCursor:null,observedAt:time};},async order(){calls++;if(fail)throw new Error('offline');return normalizeTradeOrder(detail(),source);}}});
 await ledger.runOnce(AbortSignal.timeout(1000));assert.ok(state.sources()[0]!.lastError);fail=false;time=100000;
 await ledger.runOnce(AbortSignal.timeout(1000));assert.equal(calls,2);assert.equal(state.sources()[0]!.lastError,null);assert.equal(repo.entries.filter(e=>e.kind==='fill').length,1);state.close();
});
test('paginated backfill reports the first page observation time instead of claiming newer orders were checked at the end',async()=>{
 const state=openTradeState(':memory:'),repo=repository();let time=1000;state.link({trader,source,linkedAt:1000,historicalFrom:null});
 const ledger=createTradeLedger({state,repository:repo as any,now:()=>time,sourceAdapter:{async validateBinding(){},async page(_source,cursor){return {orders:[],nextCursor:cursor?null:'older',observedAt:time};},async order(){return normalizeTradeOrder(detail(),source);}}});
 const id=state.sources()[0]!.id;await ledger.syncSource(id,AbortSignal.timeout(1000));time=1000000;await ledger.syncSource(id,AbortSignal.timeout(1000));
 assert.equal(state.sources()[0]!.coverage!.through,1000);assert.equal(state.sources()[0]!.coverage!.sourceExhausted,true);state.close();
});
test('a pending order discovered directly on Definitive remains tracked after source unlink',async()=>{
 const state=openTradeState(':memory:'),repo=repository();state.link({trader,source,linkedAt:1000,historicalFrom:null});let calls=0;
 const pending=detail();pending.order.status='ORDER_STATUS_PENDING';pending.fills=[];
 const ledger=createTradeLedger({state,repository:repo as any,now:()=>2000,sourceAdapter:{async validateBinding(){},async page(){return {orders:[normalizeTradeOrder(pending,source)],nextCursor:null,observedAt:2000};},async order(){calls++;return normalizeTradeOrder(detail(),source);}}});
 await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));state.unlink(source,trader,2500);await ledger.runOnce(AbortSignal.timeout(1000));
 assert.equal(calls,1);assert.equal(repo.entries.filter(e=>e.kind==='fill').length,1);state.close();
});
