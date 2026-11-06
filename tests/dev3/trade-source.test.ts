import test from 'node:test';
import assert from 'node:assert/strict';
import {createTradeSource,normalizeTradeOrder} from '../../src/features/builder/execution/trade-source.ts';
import {trader,source,detail} from './trade-fixtures.ts';
test('cancelled partial orders retain finalized fills, asset identities and evidenced USD fees',()=>{
 const result=normalizeTradeOrder(detail(),source);
 assert.equal(result.status,'ORDER_STATUS_CANCELLED');assert.equal(result.fills.length,1);
 assert.equal(result.fills[0]!.quantity,'2');assert.equal(result.fills[0]!.feeUsd,'0.1');
 assert.equal(result.fills[0]!.baseAsset,'eip155:8453:0x'+'1'.repeat(40));
 const wrong=detail();wrong.order.funderAddress='0x'+'b'.repeat(40);assert.throws(()=>normalizeTradeOrder(wrong,source));
 const bad=detail();bad.fills[0]!.rootOrderId='another';assert.throws(()=>normalizeTradeOrder(bad,source));
});
test('source pagination is bounded and failed pages cannot become exhausted history',async()=>{
 const calls:string[]=[];
 const read=createTradeSource({credentials:()=>({key:'configured'}),fetcher:async(url:any)=>{calls.push(String(url));return Response.json(String(url).includes('/orders?')?{orders:[{orderId:'buy'}],nextPageToken:'next'}:detail());}});
 const page=await read.page(source,null,AbortSignal.timeout(1000));assert.equal(page.nextCursor,'next');assert.equal(page.orders.length,1);
 assert.match(calls[0]!,/funderAddress=/);
 const failed=createTradeSource({credentials:()=>({key:'configured'}),fetcher:async()=>new Response('',{status:503})});
 await assert.rejects(failed.page(source,'next',AbortSignal.timeout(1000)));
});
test('portfolio authorization binds an actual provider signer and rejects unrelated profiles',async()=>{
 const vault='0x'+'b'.repeat(40),p={kind:'portfolio' as const,sourceId:'portfolio-id',wallet:vault,chainFamily:'evm' as const};
 const api=createTradeSource({credentials:()=>({key:'configured',secret:'dpks_secret'}),fetcher:async(_url:any,init:any)=>{
  assert.ok(init.headers['x-definitive-signature']);return Response.json({portfolioId:'portfolio-id',vaults:[{vaultId:'vault',address:vault,chain:{namespace:'eip155',id:'8453'},signers:[trader]}]});
 }});
 await api.validateBinding({trader,source:p,linkedAt:1,historicalFrom:null});
 await assert.rejects(api.validateBinding({trader:'0x'+'c'.repeat(40),source:p,linkedAt:1,historicalFrom:null}));
});
test('portfolio orders must belong to the selected authorized vault, not merely the same portfolio',async()=>{
 const p={kind:'portfolio' as const,sourceId:'portfolio-id',wallet:trader,chainFamily:'evm' as const};
 const row:any=detail();row.order.portfolioId='portfolio-id';row.order.orderSide='ORDER_SIDE_BUY';row.order.vaultId='other-vault';
 const api=createTradeSource({credentials:()=>({key:'configured',secret:'dpks_secret'}),pause:async()=>{},fetcher:async(url:any)=>Response.json(String(url).endsWith('/portfolio')?{portfolioId:'portfolio-id',vaults:[{vaultId:'selected',address:trader,signers:[trader]}]}:row)});
 await assert.rejects(api.order(p,'buy',AbortSignal.timeout(1000)));
});
test('portfolio backfill filters other vaults while preserving provider pagination',async()=>{
 const p={kind:'portfolio' as const,sourceId:'portfolio-id',wallet:trader,chainFamily:'evm' as const},row:any=detail();row.order.portfolioId=p.sourceId;row.order.orderSide='ORDER_SIDE_BUY';row.order.vaultId='selected';
 const api=createTradeSource({credentials:()=>({key:'configured',secret:'dpks_secret'}),pause:async()=>{},fetcher:async(url:any)=>{
  const path=new URL(url).pathname;
  return Response.json(path.endsWith('/portfolio')?{portfolioId:p.sourceId,vaults:[{vaultId:'selected',address:trader,signers:[trader]}]}:path.endsWith('/orders')?{orders:[{orderId:'foreign',portfolioId:p.sourceId,vaultId:'another'},{orderId:'buy',portfolioId:p.sourceId,vaultId:'selected'}],hasNextPage:false,nextCursor:null}:row);
 }});
 const page=await api.page(p,null,AbortSignal.timeout(1000));assert.equal(page.orders.length,1);assert.equal(page.orders[0]!.orderId,'buy');assert.equal(page.nextCursor,null);
});
test('a provider fill in the future cannot become a verified execution',()=>{
 assert.throws(()=>normalizeTradeOrder(detail(),source,Date.parse('2026-10-31T00:00:00Z')));
 assert.equal(normalizeTradeOrder(detail(),source,Date.parse('2026-11-02T00:00:00Z')).fills.length,1);
});
