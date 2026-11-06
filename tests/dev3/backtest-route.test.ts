import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDemoServer} from '../../src/features/builder/demo/server.mjs';
import {priceStrategy} from '../../src/features/builder/market/config.ts';

test('backtest route uses server history without AI or wallet calls and rejects forged history and foreign origins',async()=>{
 const calls:string[]=[];
 const start=Date.UTC(2025,0,1);
 const server=createDemoServer({fetcher:async(url:any)=>{calls.push(String(url));return Response.json([0,1,2].map(i=>[start/1000+i*86400,1999,2101,2050,2050,10]));}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as any,base=`http://127.0.0.1:${address.port}`;
 const body={strategy:priceStrategy,pairId:'eth-usdc',start:'2025-01-01',end:'2025-01-04',interval:86400,initialCashUsd:100,maxTurnoverUsd:1000,feeBps:10,slippageBps:10};
 const send=(data=body,headers={})=>fetch(base+'/api/backtest',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
   assert.equal((await fetch(base+'/api/backtest')).status,405);
   assert.equal((await send(body,{Origin:'https://foreign.example'})).status,403);
   assert.equal((await send({...body,candles:[]} as any)).status,400);
   assert.equal(calls.length,0);
   const response=await send(),payload=await response.json();
   assert.equal(response.status,200,JSON.stringify(payload));
   assert.equal(payload.data.mode,'BACKTEST');
   assert.equal(payload.data.execution.orders.length,1);
   assert.equal(payload.data.report.filledOrders,1);
   assert.equal(calls.length,1);
   assert.ok(calls[0]!.startsWith('https://api.exchange.coinbase.com/products/ETH-USD/candles?'));
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
