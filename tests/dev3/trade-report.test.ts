import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTradeReport} from '../../src/features/builder/execution/trade-report.ts';
import {buildTradeRecord} from '../../src/integrations/arkiv/trade-contracts.ts';
import {normalizeTradeOrder} from '../../src/features/builder/execution/trade-source.ts';
import {detail,source,trader} from './trade-fixtures.ts';
function entries(){
 const fills=[normalizeTradeOrder(detail(),source).fills[0]!,normalizeTradeOrder(detail('sell','sell','1','40','2026-11-02T00:00:00Z'),source).fills[0]!];
 const common={schemaVersion:1 as const,trader,source,observedAt:Date.parse('2026-11-03T00:00:00Z')};
 return [buildTradeRecord({...common,kind:'source-link',data:{trader,source,linkedAt:1000,historicalFrom:null}}),...fills.map(data=>buildTradeRecord({...common,kind:'fill',data})),buildTradeRecord({...common,kind:'coverage',data:{from:fills[0]!.filledAt,through:common.observedAt,lastSyncedAt:common.observedAt,sourceExhausted:true,gaps:[],disputed:false,renewalHealthy:true}})].map((r,i)=>({...r,entityKey:('0x'+String(i).padStart(64,'0')) as `0x${string}`,expiresAtBlock:'99999999'}));
}
test('Arkiv reports deduplicate actual fills, retain losses and keep buys separate from realized sells',()=>{
 const records=entries(),report=buildTradeReport([...records,records[1]!],{now:Date.parse('2026-11-03T00:00:30Z')});
 assert.equal(report.fills,2);assert.equal(report.markets[0]!.realizedPnl,'-10');assert.equal(report.feesUsd,'0.2');
 assert.equal(report.transactions.find(r=>r.side==='BUY')!.realizedPnl,null);assert.equal(report.provenance,'arkiv');assert.equal(report.complete,true);
});
test('missing coverage, conflicting evidence and stale sync cannot become a complete rank',()=>{
 const records=entries();assert.equal(buildTradeReport(records.slice(0,-1)).complete,false);
 assert.equal(buildTradeReport(records,{now:Date.parse('2026-11-04T00:00:00Z')}).complete,false);
 const report=buildTradeReport([...records,{...records[1]!,recordHash:('0x'+'f'.repeat(64)) as `0x${string}`}],{now:Date.parse('2026-11-03T00:00:30Z')});
 assert.equal(report.complete,false);assert.ok(report.markets.every(m=>!m.eligibleForRanking));
});
test('the same wallet execution exposed through both Definitive APIs cannot double its profit or fill count',()=>{
 const records=entries(),mirrored=records.map((entry,i)=>{
  const {identity,recordHash,entityKey,expiresAtBlock,...input}=entry;
  const source={...input.source,kind:'portfolio' as const,sourceId:'portfolio'};
  const data=input.kind==='source-link'?{...input.data,source}:input.kind==='fill'?{...input.data,evidenceHash:'0x'+'f'.repeat(64)}:input.data;
  return {...buildTradeRecord({...input,source,data} as any),entityKey:('0x'+String(i+100).padStart(64,'0')) as `0x${string}`,expiresAtBlock};
 });
 const report=buildTradeReport([...records,...mirrored],{now:Date.parse('2026-11-03T00:00:30Z')});
 assert.equal(report.fills,2);assert.equal(report.markets[0]!.realizedPnl,'-10');assert.equal(report.feesUsd,'0.2');
});
