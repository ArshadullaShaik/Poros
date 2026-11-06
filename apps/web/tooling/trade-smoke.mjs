import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';
try{loadEnvFile(fileURLToPath(new URL('../../../.env.local',import.meta.url)));}catch(e){if(e.code!=='ENOENT')throw e;}
assert.equal(process.env.ARKIV_TRADE_LIVE_SMOKE,'1','Explicit funded-writer live smoke opt-in required');
const {getTradeRuntime}=await import('../../../src/features/builder/server/trade-runtime.ts');
const runtime=getTradeRuntime();assert.ok(runtime,'Trade writer is not configured');
try{
 const trader=process.env.TRADE_LEDGER_SMOKE_TRADER;assert.match(trader??'',/^0x[0-9a-f]{40}$/);
 const source=runtime.state.sources(trader).find(s=>s.active);assert.ok(source,'Link a real source in Profile first');
 await runtime.repository.ready();
 await runtime.ledger.syncSource(source.id,AbortSignal.timeout(600000));
 const fill=runtime.state.receipts().find(e=>e.kind==='fill'&&e.trader===trader);assert.ok(fill,'No verified real fill has been recorded; check source access and recording status');
 const read=await runtime.repository.read(fill.entityKey);assert.equal(read.recordHash,fill.recordHash);
 const {schemaVersion,kind,source:ref,observedAt,data}=fill;
 const repeated=await runtime.repository.append({schemaVersion,kind,trader,source:ref,observedAt,data});assert.equal(repeated.entityKey,fill.entityKey,'Same fill must not create another record');
 const renewed=await runtime.repository.renew(fill.entityKey);assert.ok(BigInt(renewed.expiresAtBlock)>BigInt(read.expiresAtBlock));runtime.state.confirm(fill.identity,renewed);
 console.log(JSON.stringify({verified:true,entityKey:fill.entityKey,identity:fill.identity,renewalTx:renewed.txHash}));
}finally{runtime.state.close();}
