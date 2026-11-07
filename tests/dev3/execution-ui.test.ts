import assert from "node:assert/strict";
import { test } from "node:test";
import { mountExecution } from "../../src/features/builder/demo/execution.js";
import { runPaperStrategy } from "../../src/features/builder/execution/paper.ts";
import { validateStrategy } from "../../src/features/builder/index.ts";
import { createSyntheticCandles } from "../../src/features/builder/demo/replay.js";
import { marketContext as fixtureContext,priceStrategy as rsiStrategy } from "../../src/features/builder/market/config.ts";

class Control {
  value="";textContent="";hidden=false;disabled=false;children:any[]=[];handlers:Record<string,Function>={};dataset={};
  classList={add(){},remove(){}};
  addEventListener(name:string,handler:Function){this.handlers[name]=handler;}
  append(...children:any[]){this.children.push(...children);}
  replaceChildren(...children:any[]){this.children=children;}
  setAttribute(){}
}
async function setup(request?:Function, mayReplace=()=>true, marketData:any={source:"CHAINLINK_FLASH",priceUsd:"2000.000000",closedObservations:90,stale:false},getPair?:Function,onActivity=()=>{},onLoading=(_loading:boolean)=>{}) {
  const controls=new Map<string,Control>();
  for(const id of ["market-price","market-status","execution-library","creator-library","creators-empty","canvas","execution-selected","execution-mode","execution-capital","execution-turnover","execution-fee","execution-slippage","execution-start","execution-stop","execution-help","execution-status","execution-results","wallet-connect"])controls.set(`#${id}`,new Control());
  controls.get("#execution-mode")!.value="RULES_ONLY";controls.get("#execution-capital")!.value="1000";controls.get("#execution-turnover")!.value="2000";controls.get("#execution-fee")!.value="10";controls.get("#execution-slippage")!.value="25";
  let draft=structuredClone(rsiStrategy),applied=0,textEntry;
  const sent:any[]=[];
  const fetcher=async(url:string,init:RequestInit)=>{
    if(url.startsWith("/api/market"))return Response.json({ok:true,data:marketData});
    sent.push({url,init});
    if(request)return request(url,init);
    const body=JSON.parse(init.body as string);
    return Response.json({ok:true,data:{id:"ui-session",status:body.action==="check"?"COMPLETED":"WAITING",message:"Paper action complete",mode:"PAPER",orders:[],cashUsd:"1000.000000",baseQuantity:"0.00000000",turnoverUsd:"0.000000",inference:[]}});
  };
  const module=mountExecution({root:{querySelector:selector=>controls.get(selector),createElement:()=>new Control()},getDraft:()=>draft,applyDraft:next=>{draft=next;applied++;},validateDraft:next=>validateStrategy(next,fixtureContext),getApiKey:()=>"sk-ui-execution-test-key",onText:entry=>{textEntry=entry;},onActivity,onLoading,mayReplace,request:fetcher,...(getPair?{getPair}:{} )});
  await module.refreshMarket();
  const event=(id:string,name="click",extra={})=>controls.get(`#${id}`)!.handlers[name]?.({preventDefault(){},stopImmediatePropagation(){},...extra});
  return {module,controls,sent,event,get textEntry(){return textEntry;},get applied(){return applied;},get draft(){return draft;},edit(){draft={...draft,name:"Edited later"};module.draftChanged();}};
}

test("unlocked host strategies become whole draggable cards with a click equivalent",async()=>{
  const strategy={...rsiStrategy,name:"Purchased RSI strategy"};
  const ui=await setup();ui.module.addUnlockedStrategy({strategy,versionId:"bought-v1"});
  const card=ui.controls.get("#execution-library")!.children[0];
  assert.equal(card.draggable,true);
  card.handlers.click();assert.equal(ui.applied,1);
  let payload="";card.handlers.dragstart({dataTransfer:{setData(_type:string,text:string){payload=text;}}});
  ui.event("canvas","drop",{dataTransfer:{getData(){return payload;}}});
  assert.equal(ui.applied,2);
  assert.deepEqual(ui.draft,strategy);
  assert.equal(ui.sent.length,0);
  assert.match(ui.controls.get("#execution-selected")!.textContent,/bought-v1/);
  assert.throws(()=>ui.module.addUnlockedStrategy({strategy:{...rsiStrategy,name:"tampered version"},versionId:"bought-v1"}));
});

test("private member strategy loads only into the canvas without retaining a library card or starting execution",async()=>{
  const ui=await setup();
  await ui.module.openUnlockedStrategy({strategy:rsiStrategy,versionId:"member-v1"});
  assert.equal(ui.applied,1);
  assert.equal(ui.controls.get("#execution-library")!.children.length,0);
  assert.equal(ui.sent.length,0);
});

test("canvas drops ignore block drags and reject unknown unlocked cards",async()=>{
  const ui=await setup();
  const previousStatus=ui.controls.get("#execution-status")!.textContent;
  let stopped=false;
  const drop=(payload:object)=>ui.event("canvas","drop",{dataTransfer:{getData(){return JSON.stringify(payload);}},stopImmediatePropagation(){stopped=true;}});
  drop({kind:"palette",type:"indicator.rsi"});
  assert.equal(stopped,false);
  assert.equal(ui.controls.get("#execution-status")!.textContent,previousStatus);
  drop({kind:"unlocked-strategy",id:"unknown"});
  assert.equal(stopped,true);
  assert.equal(ui.applied,0);
  assert.match(ui.controls.get("#execution-status")!.textContent,/unlocked library/);
});

test("followed creators render from the host list and clear when memberships change",async()=>{
  const ui=await setup();
  assert.equal(ui.controls.get("#creators-empty")!.hidden,false);
  ui.module.setFollowedCreators([{id:"creator-1",name:"RSI Research"}]);
  const list=ui.controls.get("#creator-library")!;
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children[0].textContent,"RSI Research");
  assert.equal(ui.controls.get("#creators-empty")!.hidden,true);
  ui.module.setFollowedCreators([]);
  assert.equal(list.children.length,0);
  assert.equal(ui.controls.get("#creators-empty")!.hidden,false);
  assert.equal(ui.sent.length,0);
});

test("invalid creator updates preserve the previous list",async()=>{
  const ui=await setup();
  ui.module.setFollowedCreators([{id:"creator-1",name:"RSI Research"}]);
  for(const invalid of [null,{},[{id:"creator-2",name:""}],[{id:"",name:"Name"}],[{id:"creator-2",name:"Name"},{id:"creator-2",name:"Other name"}]]) {
    assert.throws(()=>ui.module.setFollowedCreators(invalid));
    assert.equal(ui.controls.get("#creator-library")!.children[0].children[0].textContent,"RSI Research");
    assert.equal(ui.controls.get("#creators-empty")!.hidden,true);
  }
});

test("local replay sends no stored key and displays actual engine results",async()=>{
  const ui=await setup();await ui.event("execution-start");
  assert.equal(ui.sent.length,2);
  assert.equal(ui.sent[0].url,"/api/monitor");
  assert.equal(JSON.parse(ui.sent[1].init.body).action,"check");
  assert.equal(ui.sent[0].init.headers.Authorization,undefined);
  assert.equal(JSON.parse(ui.sent[0].init.body).mode,"RULES_ONLY");
  assert.equal(JSON.parse(ui.sent[0].init.body).candles,undefined);
  assert.equal(ui.controls.get("#execution-results")!.hidden,false);
  assert.match(ui.controls.get("#execution-status")!.textContent,/paper/i);
});

test("runs reject stale live prices without waiting for any historical observations",async()=>{
  const ui=await setup(undefined,()=>true,{source:"CHAINLINK_FLASH",priceUsd:"2000.000000",stale:true});
  assert.equal(ui.controls.get("#execution-start")!.disabled,true);await ui.event("execution-start");assert.equal(ui.sent.length,0);
});

test("malformed market data cannot enable a paid run",async()=>{
  const ui=await setup(undefined,()=>true,{source:"SYNTHETIC",priceUsd:"2000.000000",closedObservations:90,stale:false});
  assert.equal(ui.controls.get("#execution-start")!.disabled,true);
  await ui.event("execution-start");
  assert.equal(ui.sent.length,0);
  assert.match(ui.controls.get("#market-status")!.textContent,/invalid/);
});

test("Stop cancels the request and prevents a late result from appearing",async()=>{
  let resolve:Function,signal:AbortSignal;
  const ui=await setup(async(_url,init)=>{signal=init.signal;return new Promise(done=>{resolve=done;});});
  const run=ui.event("execution-start");
  assert.equal(ui.controls.get("#execution-stop")!.disabled,false);
  ui.event("execution-stop");assert.equal(signal!.aborted,true);
  resolve!(Response.json({ok:true,data:{}}));await run;
  assert.equal(ui.controls.get("#execution-results")!.hidden,true);
});

test("draft edits and limit edits invalidate a pending run",async()=>{
  for(const edit of ["draft","limits"]) {
    let resolve:Function;
    const ui=await setup(async()=>new Promise(done=>{resolve=done;}));
    const run=ui.event("execution-start");
    if(edit==="draft")ui.edit();else{ui.controls.get("#execution-turnover")!.value="10";ui.event("execution-turnover","change");}
    resolve!(Response.json({ok:true,data:{}}));await run;
    assert.equal(ui.controls.get("#execution-results")!.hidden,true);
    assert.equal(ui.controls.get("#execution-start")!.disabled,false);
  }
});

test("paid AI mode uses the tab key; provider errors leave controls usable",async()=>{
  const ui=await setup(async()=>Response.json({ok:false,error:{message:"Provider unavailable"}},{status:503}));
  ui.controls.get("#execution-mode")!.value="AI";ui.event("execution-mode","change");
  await ui.event("execution-start");
  assert.equal(ui.sent[0].init.headers.Authorization,"Bearer sk-ui-execution-test-key");
  assert.match(ui.controls.get("#execution-status")!.textContent,/Provider unavailable/);
  assert.equal(ui.controls.get("#execution-start")!.disabled,false);
});

 test("declining strategy replacement preserves edited draft and existing results",async()=>{
  const ui=await setup(undefined,()=>false);ui.edit();await ui.event("execution-start");
  const previousStatus=ui.controls.get("#execution-status")!.textContent;
  ui.module.addUnlockedStrategy({strategy:rsiStrategy,versionId:"v1"});
  ui.controls.get("#execution-library")!.children[0].handlers.click();
  let payload="";
  ui.controls.get("#execution-library")!.children[0].handlers.dragstart({dataTransfer:{setData(_type:string,text:string){payload=text;}}});
  ui.event("canvas","drop",{dataTransfer:{getData(){return payload;}}});
  assert.equal(ui.applied,0);
  assert.equal(ui.controls.get("#execution-results")!.hidden,false);
  assert.equal(ui.controls.get("#execution-status")!.textContent,previousStatus);
});

test("creator text uses the existing interpreter and inserts validated rules",async()=>{
  const ui=await setup(async()=>Response.json({ok:true,data:{status:"READY",strategy:rsiStrategy}}));
  ui.module.addUnlockedStrategy({id:"text-1",name:"Creator text",text:"Buy $20 once in the target range.",versionId:"v1"});
  await ui.controls.get("#execution-library")!.children[0].handlers.click();
  assert.equal(ui.applied,1);assert.equal(ui.sent.length,1);assert.equal(JSON.parse(ui.sent[0].init.body).text,"Buy $20 once in the target range.");
});
test("ambiguous creator instructions request clarification without changing the canvas",async()=>{
  const ui=await setup(async()=>Response.json({ok:true,data:{status:"NEEDS_CLARIFICATION",questions:["Which price?"]}}));
  ui.module.addUnlockedStrategy({id:"text-1",name:"Ambiguous",text:"Buy when cheap",versionId:"v1"});
  await ui.controls.get("#execution-library")!.children[0].handlers.click();
  assert.equal(ui.applied,0);assert.equal(ui.sent.length,1);assert.match(ui.controls.get("#execution-status")!.textContent,/Which price/);
});

test("an ETH feed cannot enable Run for a selected BTC pair",async()=>{
  const ui=await setup(undefined,()=>true,{source:"CHAINLINK_FLASH",pairId:"eth-usdc",priceUsd:"2000.000000",stale:false},()=>({id:"btc-usdt",base:{symbol:"cbBTC",reference:"BTC"},quote:{symbol:"USDT"}}));
  assert.equal(ui.controls.get("#execution-start")!.disabled,true);assert.match(ui.controls.get("#market-status")!.textContent,/another trading pair/);
  await ui.event("execution-start");assert.equal(ui.sent.length,0);
});

 test("market readiness works without the removed price-status box",async()=>{
  const ui=await setup();
  ui.controls.delete("#market-price");ui.controls.delete("#market-status");
  await ui.module.refreshMarket();
  assert.equal(ui.controls.get("#execution-start")!.disabled,false);
 });

test("a chart observer failure cannot interrupt monitor execution",async()=>{
 const ui=await setup(undefined,()=>true,undefined,undefined,()=>{throw new Error("Chart failed");});
 await ui.event("execution-start");assert.equal(ui.sent.length,2);assert.equal(ui.controls.get("#execution-stop")!.disabled,true);
});

test('changing funds mode stops the current monitor before another run can start',async()=>{
  const ui=await setup(async()=>Response.json({ok:true,data:{id:'waiting-session',status:'WAITING',message:'Waiting for target',mode:'PAPER',orders:[],cashUsd:'1000.000000',baseQuantity:'0.00000000',turnoverUsd:'0.000000',inference:[]}}));await ui.event('execution-start');
  ui.controls.get('#execution-mode')!.value='LIVE';ui.event('execution-mode','change');
  assert.ok(ui.sent.some(item=>JSON.parse(item.init.body as string).action==='stop'));
  assert.equal(ui.controls.get('#execution-results')!.hidden,true);
  assert.match(ui.controls.get('#execution-status')!.textContent,/Submitted live orders remain active/);
  assert.match(ui.controls.get('#execution-help')!.textContent,/Real funds/);
});


test('strategy loading state lasts through interpretation and clears after success or failure',async()=>{
  for(const fail of [false,true]){
    let finish!:(response:Response)=>void,loading=false;
    const ui=await setup(async()=>new Promise<Response>(resolve=>{finish=resolve;}),undefined,undefined,undefined,undefined,value=>{loading=value;});
    const pending=ui.module.openUnlockedStrategy({id:'loading-text',versionId:'v1',name:'Creator idea',text:'Buy $1 ETH at 2100'});
    assert.equal(loading,true);assert.equal(ui.applied,0);
    finish(Response.json(fail?{ok:false,error:{message:'Unavailable'}}:{ok:true,data:{status:'READY',strategy:rsiStrategy}}));
    await pending;assert.equal(loading,false);assert.equal(ui.applied,fail?0:1);
  }
});


test('live targets automatically request a wallet signature, and confirmation or Stop still controls submission',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const wallet='0x1111111111111111111111111111111111111111';
  const previous=(globalThis as any).ethereum;
  try {
    for(const outcome of ['confirm','decline','stop']){
      let finish!:(signature:string)=>void,decline!:(error:unknown)=>void,signatures=0,submits=0;
      (globalThis as any).ethereum={request:async({method}:any)=>{
        if(method==='eth_requestAccounts'||method==='eth_accounts')return [wallet];
        if(method==='eth_chainId')return '0x2105';
        if(method==='eth_signTypedData_v4'){signatures++;return new Promise((resolve,reject)=>{finish=resolve;decline=reject;});}
        throw new Error('Unexpected wallet method: '+method);
      }};
      const ui=await setup(async(_url:any,init:any)=>{
        const body=JSON.parse(init.body);
        if(body.action==='submit')submits++;
        return Response.json({ok:true,data:{id:'auto-wallet-session',status:body.action==='check'?'AWAITING_WALLET':'WAITING',message:'Wallet approval required',mode:'LIVE',orders:[],liveOrders:[],cashUsd:'10.000000',turnoverUsd:'0.000000',walletRequest:body.action==='check'?{quoteId:'quote-auto',networkId:8453,funderAddress:wallet,deadlineMs:Date.now()+300000,typedData:'{}',side:'BUY',notionalUsd:'0.100000',effectivePriceUsd:'2500.000000',expectedReceive:'0.00004'}:null}});
      });
      ui.draft.riskPolicy.paperTradingOnly=false;
      ui.controls.get('#execution-mode')!.value='LIVE';await ui.event('wallet-connect');
      await ui.event('execution-start');await new Promise(resolve=>setImmediate(resolve));
      assert.equal(signatures,1);assert.equal(submits,0);
      const button=ui.controls.get('#execution-results')!.children.find(item=>item instanceof Control&&item.textContent.includes('wallet'));
      t.mock.timers.tick(10000);
      await new Promise(resolve=>setImmediate(resolve));
      assert.ok(ui.controls.get('#execution-results')!.children.includes(button),'polling must preserve the active wallet approval control');
      await button.handlers.click();assert.equal(signatures,1);
      if(outcome==='stop')ui.event('execution-stop');
      if(outcome==='decline')decline(Object.assign(new Error('Declined'),{code:4001}));else finish('0x'+'a'.repeat(130));
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(submits,outcome==='confirm'?1:0);
      ui.module.invalidate();
    }
  } finally {(globalThis as any).ethereum=previous;}
});

test('member strategy expiry during interpretation prevents final canvas insertion',async()=>{
 const original=Date.now;let now=1000;Date.now=()=>now;
 try{
  let finish!:(response:Response)=>void;
  const ui=await setup(async()=>new Promise<Response>(resolve=>{finish=resolve;}));
  const pending=ui.module.openUnlockedStrategy({id:'private',versionId:'v1',name:'Private',text:'Buy WETH at 2100',expiresAt:2000});
  assert.equal(ui.applied,0);now=2000;
  finish(Response.json({ok:true,data:{status:'READY',strategy:rsiStrategy}}));await pending;
  assert.equal(ui.applied,0);assert.match(ui.controls.get('#execution-status')!.textContent,/expired/i);
 }finally{Date.now=original;}
});
