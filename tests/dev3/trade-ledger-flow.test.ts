import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTradeState} from '../../src/features/builder/server/trade-state.ts';
import {createTradeLedger} from '../../src/features/builder/server/trade-ledger.ts';
import {buildTradeReport} from '../../src/features/builder/execution/trade-report.ts';
import {normalizeTradeOrder} from '../../src/features/builder/execution/trade-source.ts';
import {detail,source,trader,repository} from './trade-fixtures.ts';
test('verified history keeps partial losses through lost inclusion, restart, repeated pages and unlinking',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'trade-flow-')),path=join(dir,'ledger.sqlite'),repo=repository();let time=Date.parse('2026-11-03T00:00:00Z'),state=openTradeState(path);
 try{
  state.link({trader,source,linkedAt:time,historicalFrom:null});
  const orders=[normalizeTradeOrder(detail(),source),normalizeTradeOrder(detail('sell','partial-sell','1','40','2026-11-02T00:00:00Z'),source)];
  const adapter={async validateBinding(){},async page(){return {orders,nextCursor:null,observedAt:time};},async order(){return orders[0]!;}};
  let ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:adapter,now:()=>time});
  repo.loseResponse=true;await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));state.close();state=openTradeState(path);
  ledger=createTradeLedger({state,repository:repo as any,sourceAdapter:adapter,now:()=>time});time+=120001;
  await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
  await ledger.syncSource(state.sources()[0]!.id,AbortSignal.timeout(1000));
  const report=buildTradeReport(repo.entries,{now:time});assert.equal(report.complete,true);assert.equal(report.fills,2);assert.equal(report.markets[0]!.realizedPnl,'-10');
  time++;state.unlink(source,trader,time);state.enqueue({schemaVersion:1,kind:'source-unlink',trader,source,observedAt:time,data:{unlinkedAt:time}});
  await ledger.runOnce(AbortSignal.timeout(1000));const historical=buildTradeReport(repo.entries,{now:time});
  assert.equal(historical.fills,2);assert.equal(historical.complete,false);assert.equal(historical.transactions.find(f=>f.orderId==='partial-sell')!.value,'40');assert.equal(historical.coverage[0]!.active,false);
 }finally{state.close();rmSync(dir,{recursive:true,force:true});}
});
