import assert from "node:assert/strict";
import {test} from "node:test";
import {FLASH_ALLOWANCE,validateWalletQuote,createFlashOrders} from "../../src/features/builder/execution/flash-orders.ts";
import {signFlashOrder,connectBrowserWallet} from "../../src/features/builder/demo/wallet.js";
import {createPriceMonitor} from "../../src/features/builder/execution/monitor.ts";
import {priceStrategy} from "../../src/features/builder/market/config.ts";
const wallet="0x1111111111111111111111111111111111111111",time=1800000000000;
const order={side:"buy",qty:"20.000000",funderAddress:wallet};
test('zero live slippage is rejected before requesting a balance or quote',async()=>{
 let calls=0;
 const orders=createFlashOrders({fetcher:async()=>{calls++;return Response.json({});}});
 await assert.rejects(orders.prepare({action:{side:'BUY',notionalUsd:20},condition:{minPriceUsd:1900,maxPriceUsd:2100},funderAddress:wallet,priceUsd:'2000',maxSlippageBps:0}),/positive.*slippage/i);
 assert.equal(calls,0);
});
test('out-of-range wallet quote reports the executable price and order size',async()=>{
 const q=quote();q.to.amount='0.005';
 const orders=createFlashOrders({now:()=>time,fetcher:async(url)=>String(url).includes('/quote')?Response.json(q):Response.json({jsonrpc:'2.0',id:1,result:'0x100000000'})});
 await assert.rejects(orders.prepare({action:{side:'BUY',notionalUsd:20},condition:{minPriceUsd:1900,maxPriceUsd:2100},funderAddress:wallet,priceUsd:'2000',maxSlippageBps:25}),/outside the creator’s price range.*4000\.000000.*20\.000000/);
});
function quote(){
  const typed={types:{EIP712Domain:[{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],FlashOrder:[{name:"swapper",type:"address"},{name:"vault",type:"address"},{name:"recipient",type:"address"},{name:"fromToken",type:"address"},{name:"toToken",type:"address"},{name:"fromAmount",type:"uint256"},{name:"salt",type:"uint256"},{name:"deadline",type:"uint256"}]},primaryType:"FlashOrder",domain:{name:"DefinitiveFlashAllowance",version:"1",chainId:"8453",verifyingContract:FLASH_ALLOWANCE},message:{swapper:wallet,vault:"0xA181CAcfb2222eCc930dD05B43F07BA772d28034",recipient:wallet,fromToken:priceStrategy.tokenIn,toToken:priceStrategy.tokenOut,fromAmount:"20000000",salt:"1",deadline:String(time/1000+300)}};
  return {quoteId:"quote-wallet",side:"buy",orderType:"market",targetAsset:priceStrategy.tokenOut,contraAsset:priceStrategy.tokenIn,from:{asset:"contra",amount:"20"},to:{asset:"target",amount:"0.01"},evm:{permitTypedData:"",orderTypedData:JSON.stringify(typed),approveTx:{to:priceStrategy.tokenIn,data:"0x095ea7b3"+FLASH_ALLOWANCE.slice(2).toLowerCase().padStart(64,"0")+(20000000).toString(16).padStart(64,"0")}}};
}
test("wallet quote is bound to Base, recipient, amount, tokens and an exact allowance",()=>{
  assert.equal(validateWalletQuote(quote(),order,time).quoteId,"quote-wallet");
  for(const change of [
    (q:any)=>q.evm.approveTx.data=q.evm.approveTx.data.slice(0,74)+"f".repeat(64),
    (q:any)=>{const typed=JSON.parse(q.evm.orderTypedData);typed.message.recipient="0x2222222222222222222222222222222222222222";q.evm.orderTypedData=JSON.stringify(typed);},
    (q:any)=>{const typed=JSON.parse(q.evm.orderTypedData);typed.domain.chainId="1";q.evm.orderTypedData=JSON.stringify(typed);},
    (q:any)=>{const typed=JSON.parse(q.evm.orderTypedData);typed.message.fromAmount="99999999";q.evm.orderTypedData=JSON.stringify(typed);},
    (q:any)=>{const typed=JSON.parse(q.evm.orderTypedData);typed.types.EIP712Domain=[];q.evm.orderTypedData=JSON.stringify(typed);},
    (q:any)=>q.evm.permitTypedData="unapproved permit",
  ]){const q=quote();change(q);assert.throws(()=>validateWalletQuote(q,order,time));}
});
test("current Flash vault is accepted and stale or unapproved vaults are rejected",()=>{
  assert.equal(validateWalletQuote(quote(),order,time).quoteId,"quote-wallet");
  for(const vault of ["0x1074393effFCf1A15e306cD3931F48eDA9ABcd55","0x2222222222222222222222222222222222222222"]){
    const q=quote(),typed=JSON.parse(q.evm.orderTypedData);
    typed.message.vault=vault;q.evm.orderTypedData=JSON.stringify(typed);
    assert.throws(()=>validateWalletQuote(q,order,time),/Flash signing payload/);
  }
});
test("Flash order submission echoes the server-owned quote and never retries an uncertain response",async()=>{
  let calls=0,body:any;
  const orders=createFlashOrders({now:()=>time,fetcher:async(_url,init)=>{calls++;body=JSON.parse(init!.body as string);return Response.json({orderId:"ord-test"});}});
  const prepared={...validateWalletQuote(quote(),order,time),order};
  assert.equal(await orders.submit(prepared,"0x"+"a".repeat(130)),"ord-test");assert.equal(body.quoteId,"quote-wallet");assert.equal(calls,1);
  const failed=createFlashOrders({now:()=>time,fetcher:async()=>{calls++;throw new Error("private URL credential");}});
  await assert.rejects(failed.submit(prepared,"0x"+"a".repeat(130)),/unknown/);assert.equal(calls,2);
});
test("browser wallet checks account and Base, sends approval before requesting the EIP-712 signature",async()=>{
  const methods:string[]=[];
  const provider={request:async({method}:any)=>{methods.push(method);return ({eth_requestAccounts:[wallet],eth_accounts:[wallet],eth_chainId:"0x2105",eth_sendTransaction:"0x"+"1".repeat(64),eth_getTransactionReceipt:{status:"0x1"},eth_signTypedData_v4:"0x"+"a".repeat(130)} as any)[method];}};
  assert.equal(await connectBrowserWallet(provider),wallet);
  const signing=validateWalletQuote(quote(),order,time);
  await signFlashOrder({...signing,deadlineMs:Date.now()+300000,funderAddress:wallet},undefined,provider);
  assert.ok(methods.indexOf("eth_sendTransaction")<methods.indexOf("eth_signTypedData_v4"));
  await assert.rejects(signFlashOrder({...signing,deadlineMs:Date.now()+300000,funderAddress:"0x2222222222222222222222222222222222222222"},undefined,provider),/changed/);
});
test("live monitor waits for a signature, submits once and only reports completion after Flash confirms a fill",async()=>{
  let clock=time,submits=0;
  const market={refresh:async()=>market.read(),read:()=>({priceUsd:"2050.000000",stale:false})};
  const prepared={...validateWalletQuote(quote(),order,time),order,side:"BUY",notionalUsd:"20.000000",expectedReceive:"0.01",effectivePriceUsd:"2000.000000"};
  const monitor=createPriceMonitor({market,now:()=>clock,invoke:async({execute}:any)=>({fill:await execute(),inference:{model:"fake"}}),orders:{prepare:async()=>prepared,revalidate:async()=>{},submit:async()=>{submits++;return "ord-live";},status:async(id:string,funder:string,signal:AbortSignal)=>{assert.equal(id,"ord-live");assert.equal(funder,wallet);assert.ok(signal instanceof AbortSignal);return "ORDER_STATUS_FILLED";}}});
  const start=monitor.start({mode:"LIVE",wallet,strategy:{...structuredClone(priceStrategy),riskPolicy:{...priceStrategy.riskPolicy,paperTradingOnly:false}},initialCashUsd:100,maxTurnoverUsd:100,feeBps:0,slippageBps:25});
  const ready=await monitor.check(start.id,"sk-test-wallet-key");assert.equal(ready.status,"AWAITING_WALLET");assert.equal(ready.orders.length,0);assert.equal(submits,0);
  const submitted=await monitor.submit(start.id,"0x"+"a".repeat(130));assert.equal(submitted.status,"WAITING");assert.equal(submitted.liveOrders[0].status,"ORDER_STATUS_PENDING");assert.equal(submits,1);
  await assert.rejects(monitor.submit(start.id,"0x"+"a".repeat(130)));clock+=10000;
  assert.equal((await monitor.check(start.id,"sk-test-wallet-key")).status,"COMPLETED");assert.equal(submits,1);
});

test("live submission rechecks Flash range and Stop survives an accepted in-flight submission",async()=>{
  async function setup(){
    let flashPrice="2050.000000",submits=0,resolve:any;
    const prepared={...validateWalletQuote(quote(),order,time),order,side:"BUY",notionalUsd:"20.000000",expectedReceive:"0.01",effectivePriceUsd:"2000.000000"};
    const market={refresh:async()=>market.read(),read:()=>({priceUsd:"2050.000000",stale:false,flash:{priceUsd:flashPrice}})};
    const monitor=createPriceMonitor({market,now:()=>time,invoke:async({execute}:any)=>({fill:await execute(),inference:{model:"fake"}}),orders:{prepare:async()=>prepared,revalidate:async()=>{},submit:async()=>{submits++;return new Promise(done=>{resolve=done;});},status:async()=>"ORDER_STATUS_PENDING"}});
    const run=monitor.start({mode:"LIVE",wallet,strategy:{...structuredClone(priceStrategy),riskPolicy:{...priceStrategy.riskPolicy,paperTradingOnly:false}},initialCashUsd:100,maxTurnoverUsd:100,feeBps:0,slippageBps:25});
    await monitor.check(run.id,"sk-test-wallet-key");
    return {monitor,id:run.id,setPrice(value:string){flashPrice=value;},get submits(){return submits;},finish(){resolve("ord-accepted");}};
  }
  const moved=await setup();moved.setPrice("2150.000000");
  await assert.rejects(Promise.race([moved.monitor.submit(moved.id,"0x"+"a".repeat(130)),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Range check did not block submission")),100))]),/outside.*range/);assert.equal(moved.submits,0);
  const stopped=await setup(),pending=stopped.monitor.submit(stopped.id,"0x"+"a".repeat(130));
  while(!stopped.submits)await new Promise(resolve=>setImmediate(resolve));
  stopped.monitor.stop(stopped.id);stopped.finish();
  const result=await pending;assert.equal(result.status,"STOPPED");assert.equal(result.liveOrders[0].orderId,"ord-accepted");
});

test('a market-price rule prepares the exact small live order and still requires a wallet signature',async()=>{
  const {marketPriceBounds}=await import('../../src/features/builder/market/config.ts');
  let submissions=0;
  const q=quote(),typed=JSON.parse(q.evm.orderTypedData);
  q.from.amount='0.1';q.to.amount='0.00004';typed.message.fromAmount='100000';
  q.evm.orderTypedData=JSON.stringify(typed);
  q.evm.approveTx.data='0x095ea7b3'+FLASH_ALLOWANCE.slice(2).toLowerCase().padStart(64,'0')+(100000).toString(16).padStart(64,'0');
  const orders=createFlashOrders({now:()=>time,fetcher:async(url:any)=>{
    if(String(url).endsWith('/order'))submissions++;
    return Response.json(String(url).includes('flash.definitive.fi')?q:{jsonrpc:'2.0',id:1,result:'0x5f5e100'});
  }});
  const prepared=await orders.prepare({action:{side:'BUY',notionalUsd:0.1},condition:marketPriceBounds,funderAddress:wallet,priceUsd:'2750.000000',maxSlippageBps:50});
  assert.equal(prepared.order.qty,'0.100000');assert.equal(prepared.notionalUsd,'0.100000');assert.equal(prepared.effectivePriceUsd,'2500.000000');
  assert.equal(JSON.parse(prepared.typedData).message.fromAmount,'100000');assert.equal(submissions,0);
});

test('Flash order status includes the funding wallet required by the API',async()=>{
  const id='11111111-2222-4333-8444-555555555555';
  const orders=createFlashOrders({fetcher:async(url:any)=>{
    const request=new URL(String(url));
    return request.searchParams.get('funderAddress')===wallet?Response.json({order:{status:'ORDER_STATUS_FILLED'}}):Response.json({error:{code:'INVALID_ARGUMENT',message:'funderAddress is required'}},{status:400});
  }});
  assert.equal(await orders.status(id,wallet),'ORDER_STATUS_FILLED');
  const solanaWallet='11111111111111111111111111111111';
  const solana=createFlashOrders({fetcher:async(url:any)=>new URL(String(url)).searchParams.get('funderAddress')===solanaWallet?Response.json({order:{status:'ORDER_STATUS_FILLED'}}):Response.json({},{status:400})});
  assert.equal(await solana.status(id,solanaWallet),'ORDER_STATUS_FILLED');
  await assert.rejects(orders.status(id,''),/wallet/i);
});
