import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mountBacktest} from '../../src/features/builder/demo/backtest.js';
import {priceStrategy,tradingPairs} from '../../src/features/builder/market/config.ts';
class Control {
 value='';textContent='';hidden=false;disabled=false;open=false;children:any[]=[];handlers:any={};
 addEventListener(name,handler){this.handlers[name]=handler;}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(){}showModal(){this.open=true;}close(){this.open=false;}
}
function setup(request:any){
 const controls=new Map(['backtest-market','backtest-start','backtest-end','backtest-interval','backtest-balance','backtest-turnover','backtest-fee','backtest-slippage','backtest-status','backtest-form','backtest-run','backtest-view-report','backtest-report-close','backtest-report-dialog','backtest-report','backtest-presets','backtest-drop','backtest-strategy-name','backtest-setup-summary'].map(id=>[id,new Control()]));
 let draft=structuredClone(priceStrategy),changed='';
 const ui=mountBacktest({root:{querySelector:s=>controls.get(s.slice(1)),createElement:()=>new Control(),createElementNS:()=>new Control()},getDraft:()=>draft,getPair:()=>tradingPairs[0],getPairs:()=>tradingPairs,changeMarket:id=>{changed=id;},loadStrategy:async transfer=>{if(transfer.getData('text/plain')==='known-strategy'){draft={...draft,name:'Dropped creator strategy'};return true;}return false;},request});
 for(const [id,value]of Object.entries({'backtest-start':'2025-01-01','backtest-end':'2025-01-04','backtest-interval':'86400','backtest-balance':'1000','backtest-turnover':'10000','backtest-fee':'10','backtest-slippage':'25'}))controls.get(id)!.value=value;
 const submit=()=>controls.get('backtest-form')!.handlers.submit({preventDefault(){}});
 return {controls,ui,submit,edit(){draft={...draft,name:'Changed draft'};},setSlippageCap(cap:number){draft={...draft,riskPolicy:{...draft.riskPolicy,maxSlippageBps:cap}};ui.sync();},get changed(){return changed;}};
}
const response=(body:any)=>Response.json({ok:true,data:{strategy:body.strategy,strategyHash:'0x123',parameters:body,dataSource:{name:'Coinbase',product:'ETH-USD',candles:3,warmupCandles:0},disclosure:'Simulated only',execution:{summary:{finalValueUsd:'1000'},orders:[],rejections:[],assumptions:['Next open fills'],equityCurve:[{valueUsd:'1000'}]},report:{totalReturnPct:0,maxDrawdownPct:0,filledOrders:0,closedTrades:0,winRatePct:null,profitFactor:null,tradingCostsUsd:0,buyAndHoldReturnPct:0,feesUsd:0,slippageCostUsd:0,realizedPnlUsd:0,benchmarkEquityCurve:[{valueUsd:1000}],benchmark:'Buy and hold',tradeDefinition:'Closed sell fills'}}});
test('backtest controls submit the exact loaded snapshot without AI credentials and display a pinned report',async()=>{
 let sent:any;
 const ui=setup(async(url,init)=>{assert.equal(url,'/api/backtest');sent=init;return response(JSON.parse(init.body));});
 await ui.submit();
 const body=JSON.parse(sent.body);assert.deepEqual(body.strategy,priceStrategy);assert.equal(body.pairId,'eth-usdc');assert.equal(body.start,'2025-01-01');assert.equal(body.feeBps,10);
 assert.equal(sent.headers.Authorization,undefined);
 assert.equal(ui.controls.get('backtest-report-dialog')!.open,true);
 assert.equal(ui.controls.get('backtest-view-report')!.hidden,false);
 assert.equal(ui.controls.get('backtest-run')!.disabled,false);
});
test('a late backtest cannot present results as belonging to an edited canvas',async()=>{
 let resolve:any,body:any;
 const ui=setup(async(_url,init)=>{body=JSON.parse(init.body);return new Promise(done=>{resolve=done;});});
 const pending=ui.submit();ui.edit();resolve(response(body));await pending;
 assert.equal(ui.controls.get('backtest-report-dialog')!.open,false);
 assert.match(ui.controls.get('backtest-status')!.textContent,/strategy changed/i);
});
test('data errors show a clear failure and recover the run button without a fabricated report',async()=>{
 const ui=setup(async()=>Response.json({ok:false,error:{message:'Missing historical candles'}},{status:400}));
 await ui.submit();assert.equal(ui.controls.get('backtest-report-dialog')!.open,false);assert.equal(ui.controls.get('backtest-run')!.disabled,false);assert.match(ui.controls.get('backtest-status')!.textContent,/Missing historical/);
});

test('ready-made test cards work by click or drop and select valid dates with visible costs',async()=>{
 const ui=setup(async()=>{}),cards=ui.controls.get('backtest-presets')!.children;
 assert.equal(cards.length,3);
 const before=structuredClone(priceStrategy);
 cards[0].handlers.click();
 assert.equal(Date.parse(ui.controls.get('backtest-end')!.value)-Date.parse(ui.controls.get('backtest-start')!.value),7*86400000);
 assert.equal(ui.controls.get('backtest-interval')!.value,'3600');
 let payload='';cards[2].handlers.dragstart({dataTransfer:{setData(_type,value){payload=value;}}});
 await ui.controls.get('backtest-drop')!.handlers.drop({preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=>payload}});
 assert.equal(Date.parse(ui.controls.get('backtest-end')!.value)-Date.parse(ui.controls.get('backtest-start')!.value),90*86400000);
 assert.equal(ui.controls.get('backtest-interval')!.value,'86400');
 assert.equal(ui.controls.get('backtest-balance')!.value,'1000');
 assert.match(ui.controls.get('backtest-setup-summary')!.textContent,/0\.1% fee/);
 assert.deepEqual(priceStrategy,before);
});

test('dropping a strategy loads it for review without automatically making a backtest or paid request',async()=>{
 let requests=0;const ui=setup(async()=>{requests++;});
 const drop=raw=>ui.controls.get('backtest-drop')!.handlers.drop({preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=>raw}});
 await drop('known-strategy');
 assert.equal(ui.controls.get('backtest-strategy-name')!.textContent,'Dropped creator strategy');
 assert.equal(requests,0);
 await drop('unknown-strategy');
 assert.match(ui.controls.get('backtest-status')!.textContent,/could not.*load|could not.*loaded/i);
 assert.equal(ui.controls.get('backtest-run')!.disabled,false);
});

test('changing a preset cancels the old test and prevents its late report from opening',async()=>{
 let resolve:any,body:any,signal:AbortSignal;
 const ui=setup(async(_url,init)=>{body=JSON.parse(init.body);signal=init.signal;return new Promise(done=>{resolve=done;});});
 const pending=ui.submit();ui.controls.get('backtest-presets')!.children[2].handlers.click();
 assert.equal(signal!.aborted,true);resolve(response(body));await pending;
 assert.equal(ui.controls.get('backtest-report-dialog')!.open,false);
 assert.equal(ui.controls.get('backtest-run')!.disabled,false);
 assert.match(ui.controls.get('backtest-status')!.textContent,/Long view ready/);
});

test('a tighter strategy slippage cap keeps the simple flow valid without opening Advanced settings',()=>{
 const ui=setup(async()=>{});ui.controls.get('backtest-slippage')!.value='25';ui.setSlippageCap(5);
 assert.equal(ui.controls.get('backtest-slippage')!.value,'5');
 assert.match(ui.controls.get('backtest-setup-summary')!.textContent,/0\.05% slippage/);
});
