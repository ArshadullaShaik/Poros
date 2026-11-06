import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createChartState} from '../../src/features/builder/demo/chart.js';
const price=(pairId='eth-usdc',priceUsd='2500.000000')=>({source:'CHAINLINK',pairId,priceUsd,stale:false,observedAtMs:1000});
test('chart keeps real observations only, bounds memory and resets when the strategy market changes',()=>{
 const chart=createChartState();chart.select('eth-usdc');
 assert.equal(chart.observe(price('btc-usdt'),2000),false);assert.equal(chart.observe({...price(),stale:true},2000),false);assert.equal(chart.observe(price('eth-usdc','NaN'),2000),false);assert.equal(chart.snapshot().points.length,0);
 for(let i=0;i<2000;i++)chart.observe(price(),2000+i*10000);
 assert.equal(chart.snapshot().points.length,1800);assert.equal(chart.snapshot().points.at(-1)!.price,2500);
 chart.select('btc-usdt');assert.equal(chart.snapshot().points.length,0);assert.equal(chart.snapshot().markers.length,0);
});
test('chart distinguishes simulated fills, submitted orders and confirmed fills without duplicating polls',()=>{
 const chart=createChartState();chart.select('eth-usdc');chart.observe(price(),2000);
 const data={id:'run',pair:{id:'eth-usdc'},status:'WAITING',message:'Waiting for target',mode:'PAPER',orders:[{actionId:'buy',side:'BUY',priceUsd:'2499.000000',notionalUsd:'20',filledAtMs:2000}],inference:[{model:'Qwen'}]};
 chart.activity({kind:'snapshot',pairId:'eth-usdc',data,time:2000});chart.activity({kind:'snapshot',pairId:'eth-usdc',data,time:3000});
 assert.equal(chart.snapshot().markers.length,1);assert.match(chart.snapshot().markers[0]!.label,/Paper BUY/);assert.equal(chart.snapshot().inferences,1);
 const live={...data,mode:'LIVE',orders:[],liveOrders:[{orderId:'order',side:'BUY',status:'ORDER_STATUS_PENDING',submittedAtMs:4000}],marketData:{priceUsd:'2500.000000'}};
 chart.activity({kind:'snapshot',pairId:'eth-usdc',data:live,time:4000});assert.match(chart.snapshot().markers.at(-1)!.label,/Submitted/);
 chart.activity({kind:'snapshot',pairId:'eth-usdc',data:{...live,liveOrders:[{...live.liveOrders[0],status:'ORDER_STATUS_FILLED'}]},time:5000});assert.match(chart.snapshot().markers.at(-1)!.label,/Flash confirmed/);
 chart.activity({kind:'status',pairId:'btc-usdt',message:'Wrong market',time:6000});assert.doesNotMatch(chart.snapshot().message,/Wrong market/);
});

class Element {
 textContent='';dataset:any={};children:any[]=[];attrs:any={};handlers:any={};
 append(...nodes:any[]){this.children.push(...nodes);}replaceChildren(...nodes:any[]){this.children=nodes;}
 setAttribute(k:string,v:string){this.attrs[k]=v;}addEventListener(k:string,fn:Function){this.handlers[k]=fn;}
 getBoundingClientRect(){return {left:0,width:1000};}
}
test('mounted chart renders a real price and targets, rejects a stale feed and drops a late response after market changes',async()=>{
 const {mountMarketChart}=await import('../../src/features/builder/demo/chart.js');
 const ids=['chart-position','chart-pnl','chart-position-note','market-chart-svg','chart-pair','chart-network','chart-last-price','chart-agent-status','chart-ai-count','chart-targets','chart-activity','chart-observation','chart-feed-status','chart-hover'];
 const controls=new Map(ids.map(id=>[id,new Element()])),buttons=[5,15,60].map(n=>{const el=new Element();el.dataset.chartWindow=String(n);return el;});
 const root={querySelector:(id:string)=>controls.get(id.slice(1)),querySelectorAll:()=>buttons,createElement:()=>new Element(),createElementNS:()=>new Element()};
 let pairId='eth-usdc',time=2000,stale=false,delayed=false,resolve:any;
 const ui=mountMarketChart({root,getPair:()=>({id:pairId,base:{reference:pairId==='eth-usdc'?'ETH':'BTC',symbol:'TOKEN'},quote:{symbol:'USDC'},network:{name:'Base'}}),getDraft:()=>({nodes:[{type:'signal.price',minPriceUsd:2490,maxPriceUsd:2510}]}),now:()=>time,request:async()=>delayed?new Promise(done=>{resolve=done;}):Response.json({ok:true,data:{...price(pairId),stale}})});
 await ui.refresh();assert.match(controls.get('chart-last-price')!.textContent,/2,500/);assert.equal(controls.get('chart-targets')!.children.length,1);assert.equal(controls.get('chart-feed-status')!.textContent,'CHAINLINK · FALLBACK');
 stale=true;time+=10000;await ui.refresh();assert.equal(controls.get('chart-feed-status')!.textContent,'PRICE UNAVAILABLE');
 delayed=true;const pending=ui.refresh();const resolveOld=resolve;pairId='btc-usdt';ui.draftChanged();resolveOld(Response.json({ok:true,data:price('eth-usdc')}));await pending;
 assert.equal(controls.get('chart-last-price')!.textContent,'—');assert.match(controls.get('chart-pair')!.textContent,/BTC/);ui.stop();
});

test('short live history fills the chart instead of being compressed into an hour-long empty view',async()=>{
 const {chartTimeRange}=await import('../../src/features/builder/demo/chart.js');
 const points=Array.from({length:7},(_,i)=>({time:100000+i*10000}));
 assert.deepEqual(chartTimeRange(points,3600000,200000),{start:100000,end:160000});
 assert.deepEqual(chartTimeRange(points,30000,200000),{start:130000,end:160000});
 assert.deepEqual(chartTimeRange([points[0]],3600000,200000),{start:90000,end:100000});
});

test("chart accepts labelled Flash observations and retains source identity for fallback changes",()=>{
 const chart=createChartState();chart.select("eth-usdc");
 assert.equal(chart.observe({...price(),source:"FLASH"},2000),true);
 assert.equal(chart.observe(price(),7000),true);
 assert.deepEqual(chart.snapshot().points.map(point=>point.source),["FLASH","CHAINLINK"]);
 assert.equal(chart.observe({...price(),source:"UNKNOWN"},12000),false);
});

class Storage {
 values=new Map<string,string>();get length(){return this.values.size;}key(i:number){return [...this.values.keys()][i]??null;}
 getItem(key:string){return this.values.get(key)??null;}setItem(key:string,value:string){this.values.set(key,value);}removeItem(key:string){this.values.delete(key);}
}
test('price history restores immediately per pair without restoring trades or treating cache as live',()=>{
 const storage=new Storage(),now=()=>20000;
 const first=createChartState({storage,now});first.select('eth-usdc');first.observe(price(),10000);first.observe(price('eth-usdc','2501.000000'),15000);
 first.activity({kind:'status',pairId:'eth-usdc',message:'Private execution message',time:15000});
 const reopened=createChartState({storage,now});reopened.select('eth-usdc');assert.equal(reopened.snapshot().points.length,2);assert.equal(reopened.snapshot().cached,true);assert.equal(reopened.snapshot().events.length,0);assert.equal(JSON.stringify([...storage.values.values()]).includes('Private execution message'),false);
 reopened.select('btc-usdt');assert.equal(reopened.snapshot().points.length,0);reopened.select('eth-usdc');assert.equal(reopened.snapshot().points.length,2);
 reopened.observe(price(),20000);assert.equal(reopened.snapshot().cached,false);
});
test('expired, corrupt, future and wrong-pair caches are ignored; unavailable storage cannot break the chart',()=>{
 const storage=new Storage(),first=createChartState({storage,now:()=>20000});first.select('eth-usdc');first.observe(price(),10000);
 const key=storage.key(0)!;const good=storage.getItem(key)!;
 for(const raw of ['broken',JSON.stringify({...JSON.parse(good),pairId:'btc-usdt'}),JSON.stringify({...JSON.parse(good),savedAt:30000}),JSON.stringify({...JSON.parse(good),points:[{time:10000,price:-1,oracleTime:1000,source:'FLASH'}]})]){
  storage.setItem(key,raw);const ui=createChartState({storage,now:()=>20000});ui.select('eth-usdc');assert.equal(ui.snapshot().points.length,0);
 }
 storage.setItem(key,good);const expired=createChartState({storage,now:()=>4000000});expired.select('eth-usdc');assert.equal(expired.snapshot().points.length,0);
 const blocked={getItem(){throw Error('Blocked');},setItem(){throw Error('Quota');}};
 const chart=createChartState({storage:blocked,now:()=>20000});assert.doesNotThrow(()=>chart.select('eth-usdc'));assert.equal(chart.observe(price(),20000),true);
});

test('chart cache keeps only eight recent markets',()=>{
 const storage=new Storage();let time=10000;
 const chart=createChartState({storage,now:()=>time});
 for(let i=0;i<10;i++){time+=5000;const pairId='market-'+i;chart.select(pairId);chart.observe(price(pairId),time);}
 assert.equal(storage.length,8);assert.equal(storage.getItem('poros.chart.v1.market-0'),null);assert.notEqual(storage.getItem('poros.chart.v1.market-9'),null);
});

test('sampled candles calculate actual OHLC, preserve gaps, and avoid mixing quote sources',async()=>{
 const {sampledCandles}=await import('../../src/features/builder/demo/chart.js');
 const points=[{time:1000,price:100,source:'FLASH'},{time:3000,price:105,source:'FLASH'},{time:5000,price:98,source:'FLASH'},{time:7000,price:102,source:'FLASH'},{time:121000,price:110,source:'FLASH'}];
 const candles=sampledCandles(points);assert.equal(candles.length,2);assert.deepEqual([candles[0].open,candles[0].high,candles[0].low,candles[0].close],[100,105,98,102]);
 const fallback=sampledCandles([...points,{time:123000,price:108,source:'CHAINLINK'}]);assert.equal(fallback.at(-1).source,'CHAINLINK');assert.equal(fallback.at(-1).open,108);assert.equal(fallback.at(-1).high,108);
});
test('paper position computes entry and net P/L from confirmed fills, never from pending live orders',async()=>{
 const {paperPosition}=await import('../../src/features/builder/demo/chart.js');
 const orders=[{side:'BUY',notionalUsd:'20.000000',baseQuantity:'0.01000000',feeUsd:'0.020000'},{side:'SELL',notionalUsd:'10.000000',baseQuantity:'0.00500000',feeUsd:'0.010000'}];
 const position=paperPosition({mode:'PAPER',orders});assert.equal(position.quantity,0.005);assert.equal(position.entryPrice,2000);assert.ok(Math.abs(position.realizedPnl+0.02)<1e-8);assert.ok(Math.abs(position.cost-10.01)<1e-8);
 assert.equal(paperPosition({mode:'LIVE',orders,liveOrders:[{status:'ORDER_STATUS_PENDING'}]}),null);
 assert.equal(paperPosition({mode:'PAPER',orders:[orders[1]]}),null);
});


test('changing the viewed wallet clears execution activity while preserving public price observations',()=>{
 const chart=createChartState();chart.select('eth-usdc');chart.observe(price(),2000);
 chart.activity({kind:'status',pairId:'eth-usdc',time:2000,message:'Previous account activity'});
 chart.resetActivity();assert.equal(chart.snapshot().points.length,1);assert.equal(chart.snapshot().markers.length,0);assert.equal(chart.snapshot().events.length,0);
});

test('chart permits the bounded oracle clock drift accepted by the server',()=>{
 const chart=createChartState();chart.select('eth-usdc');
 assert.equal(chart.observe({...price(),observedAtMs:182000},2000),true);
 assert.equal(chart.observe({...price(),observedAtMs:302001},2000),false);
});
