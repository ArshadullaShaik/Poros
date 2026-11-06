import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTradeRecord} from '../../../src/integrations/arkiv/trade-contracts.ts';
import {decodeTradeEntity} from '../../../src/integrations/arkiv/trades.ts';
import {recordBytes} from '../../../src/integrations/arkiv/codec.ts';
const toHex=(value:Uint8Array)=>'0x'+Buffer.from(value).toString('hex');
const trader='0x'+'a'.repeat(40),source={kind:'flash' as const,sourceId:'flash:'+trader,wallet:trader,chainFamily:'evm' as const};
const record=buildTradeRecord({schemaVersion:1,kind:'order',trader,source,observedAt:1000,data:{orderId:'order',status:'ORDER_STATUS_PENDING'}});
function raw(){return {$key:'0x'+'1'.repeat(64),$creator:trader,$owner:trader,$expiresAt:100000n,$creationFlags:{readonly:true,permissionlessExtension:false},$attributes:{'arkiv.schema':{type:'str',value:'ethmumbai.trades.v1'},recordKind:{type:'str',value:'order'},trader:{type:'addr',value:trader},source:{type:'str',value:record.source.sourceId},identity:{type:'str',value:record.identity},record:{type:'bytes',value:toHex(recordBytes(record))}}};}
test('trade entities require trusted native ownership, immutability, exact indexes and canonical evidence',()=>{
 assert.equal(decodeTradeEntity(raw(),trader).identity,record.identity);
 for(const mutate of [(r:any)=>r.$creator='0x'+'b'.repeat(40),(r:any)=>r.$creationFlags.readonly=false,(r:any)=>delete r.$creationFlags.permissionlessExtension,(r:any)=>r.$attributes.identity.value='other',(r:any)=>r.$attributes.record.value=toHex(recordBytes({...record,recordHash:'0x'+'0'.repeat(64)}))]){const r=raw();mutate(r);assert.throws(()=>decodeTradeEntity(r,trader));}
 assert.throws(()=>decodeTradeEntity(raw(),trader,100000n));
});
test('repeated observation time does not change economic identity or hash',()=>{
 const {identity,recordHash,...input}=record;
 const repeated=buildTradeRecord({...input,observedAt:2000});
 assert.equal(repeated.identity,record.identity);assert.equal(repeated.recordHash,record.recordHash);
});
