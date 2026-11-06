import {chartCandles} from './chart-candles.js';
const validPrice=value=>typeof value==='string'&&/^\d+\.\d{6}$/.test(value)&&Number(value)>0&&Number(value)<=1000000;
function validHistory(candles,now){
  return Array.isArray(candles)&&candles.length>0&&candles.length<=60&&candles.every((c,i)=>c&&c.source==='COINBASE'&&Number.isSafeInteger(c.time)&&c.time%60000===0&&c.start===c.time&&c.end===c.time+60000&&c.end<=now&&(i===0||c.time>candles[i-1].time)&&[c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.low>0&&c.high<=1000000&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close));
}
export function sampledCandles(points){
  const candles=new Map();
  for(const point of points){
    const time=Math.floor(point.time/60000)*60000,previous=candles.get(time);
    if(!previous||previous.source!==point.source)candles.set(time,{time,start:point.time,end:point.time,open:point.price,high:point.price,low:point.price,close:point.price,source:point.source});
    else{previous.high=Math.max(previous.high,point.price);previous.low=Math.min(previous.low,point.price);previous.close=point.price;previous.end=point.time;}
  }
  return [...candles.values()];
}
export function paperPosition(data){
  if(data.mode!=='PAPER'||!Array.isArray(data.orders))return null;
  let quantity=0,basis=0,cost=0,realizedPnl=0;
  for(const fill of data.orders){
    const size=Number(fill.baseQuantity),notional=Number(fill.notionalUsd),fee=Number(fill.feeUsd);
    if(![size,notional,fee].every(Number.isFinite)||size<=0||notional<=0||fee<0)return null;
    if(fill.side==='BUY'){quantity+=size;basis+=notional;cost+=notional+fee;}
    else if(fill.side==='SELL'&&size<=quantity+1e-9){
      const fraction=Math.min(1,size/quantity);realizedPnl+=notional-fee-cost*fraction;basis*=1-fraction;cost*=1-fraction;quantity=Math.max(0,quantity-size);
    }else return null;
  }
  return {quantity,entryPrice:quantity>1e-9?basis/quantity:null,cost,realizedPnl};
}
export function createChartState({storage,now=Date.now}={}){
  let pairId,points=[],candles=[],markers=[],events=[],message='Ready · start a strategy to monitor its targets.',inferences=0,seen=new Set(),cached=false,position=null,livePosition=null;
  const prefix='poros.chart.v1.',maxAge=3600000;
  function select(id){
    if(id===pairId)return false;
    pairId=id;points=[];candles=[];markers=[];events=[];position=null;livePosition=null;seen.clear();inferences=0;cached=false;message='Ready · start a strategy to monitor its targets.';
    try{
      const raw=storage?.getItem(prefix+id);
      if(raw&&raw.length<=250000){
        const entry=JSON.parse(raw),time=now();
        if(entry.pairId===id&&Number.isFinite(entry.savedAt)&&entry.savedAt<=time&&time-entry.savedAt<=maxAge&&Array.isArray(entry.points)&&entry.points.length<=1800&&entry.points.every((p,i)=>
          p&&Number.isFinite(p.time)&&p.time<=time&&(i===0||p.time>entry.points[i-1].time)&&Number.isFinite(p.price)&&p.price>0&&p.price<=1000000&&Number.isFinite(p.oracleTime)&&p.oracleTime>0&&p.oracleTime<=p.time+300000&&['FLASH','CHAINLINK'].includes(p.source)
        )){points=entry.points.filter(p=>time-p.time<=maxAge);if(validHistory(entry.candles,time))candles=entry.candles.filter(c=>time-c.time<=maxAge);cached=points.length>0||candles.length>0;}
      }
    }catch{/* Browser storage is optional. */}
    return true;
  }
  function save(){
    if(!storage)return;
    try{
      storage.setItem(prefix+pairId,JSON.stringify({pairId,savedAt:now(),points,candles}));
      const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(key=>key?.startsWith(prefix));
      keys.sort((a,b)=>{try{return JSON.parse(storage.getItem(b)).savedAt-JSON.parse(storage.getItem(a)).savedAt;}catch{return 0;}});
      for(const key of keys.slice(8))storage.removeItem(key);
    }catch{/* Quota or private browsing must not stop live prices. */}
  }
  function observe(data,time){
    if(!['FLASH','CHAINLINK'].includes(data?.source)||data.pairId!==pairId||data.stale!==false||!validPrice(data.priceUsd)||!Number.isFinite(data.observedAtMs)||data.observedAtMs<=0||data.observedAtMs>time+300000||!Number.isFinite(time)||time<(points.at(-1)?.time??0))return false;
    const point={time,price:Number(data.priceUsd),oracleTime:data.observedAtMs,source:data.source};
    if(points.at(-1)?.time===time)points[points.length-1]=point;else points.push(point);
    points=points.slice(-1800);cached=false;save();return true;
  }
  function marker(key,time,price,label,side){
    if(seen.has(key)||!Number.isFinite(time)||!Number.isFinite(price)||price<=0)return;
    seen.add(key);markers.push({time,price,label,side});markers=markers.slice(-100);
    if(seen.size>1000)seen=new Set([...seen].slice(-500));
  }
  function activity(event){
    if(event.pairId!==pairId)return;
    const data=event.data,time=event.time;
    if(event.kind==='snapshot'){
      if(data?.pair?.id!==pairId)return;
      position=paperPosition(data);
      livePosition=data.mode==='LIVE'?{confirmed:(data.liveOrders??[]).filter(order=>order.status==='ORDER_STATUS_FILLED').length,pending:(data.liveOrders??[]).filter(order=>!['ORDER_STATUS_FILLED','ORDER_STATUS_CANCELLED','ORDER_STATUS_REJECTED','ORDER_STATUS_TERMINATED'].includes(order.status)).length}:null;
      inferences=Number.isSafeInteger(data.inferenceCount)&&data.inferenceCount>=0?data.inferenceCount:Array.isArray(data.inference)?data.inference.length:0;
      for(const fill of data.orders??[])if(data.mode==='PAPER'&&validPrice(fill.priceUsd))marker(`${data.id}:paper:${fill.actionId}:${fill.filledAtMs}`,fill.filledAtMs,Number(fill.priceUsd),`Paper ${fill.side} · $${fill.notionalUsd}`,fill.side);
      for(const order of data.liveOrders??[]){
        const filled=order.status==='ORDER_STATUS_FILLED',label=({'ORDER_STATUS_FILLED':'Flash confirmed','ORDER_STATUS_CANCELLED':'Cancelled','ORDER_STATUS_REJECTED':'Rejected','ORDER_STATUS_TERMINATED':'Terminated'})[order.status]??'Submitted';
        marker(`${data.id}:live:${order.orderId}:${order.status}`,filled?time:order.submittedAtMs,Number(data.marketData?.priceUsd??points.at(-1)?.price),`${label} ${order.side} · reference price`,order.side);
      }
      if(data.walletRequest)marker(`${data.id}:quote:${data.walletRequest.quoteId}`,time,Number(data.walletRequest.effectivePriceUsd),'Wallet approval required · Flash quote',data.walletRequest.side);
    }
    const next=event.message??data?.message;
    if(typeof next==='string'&&next!==message){message=next;events.push({time,message});events=events.slice(-30);}
  }
  function history(data){
    if(data?.pairId!==pairId||data.source!=='COINBASE'||!validHistory(data.candles,now()))return false;
    candles=data.candles.filter(c=>now()-c.time<=maxAge);save();return true;
  }
  return {select,observe,history,activity,resetActivity(){markers=[];events=[];seen.clear();position=null;livePosition=null;inferences=0;message='Ready · start a strategy to monitor its targets.';},snapshot:()=>({pairId,points:[...points],candles:[...candles],markers:[...markers],events:[...events],message,inferences,cached,position,livePosition})};
}

export function chartTimeRange(points,windowMs,now){
  const end=points.at(-1)?.time??now;
  const start=Math.max(end-windowMs,points[0]?.time??end-windowMs);
  return {start:start===end?end-10000:start,end};
}

export function mountMarketChart({root=document,getPair,getDraft,request=fetch,now=Date.now,historyFeed}){
  let storage;try{storage=root.defaultView?.localStorage;}catch{}
  const $=id=>root.querySelector(`#${id}`),svg=$('market-chart-svg'),state=createChartState({storage,now});
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value<1?6:2}).format(value);
  const clock=time=>new Date(time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const axisTime=time=>new Date(time).toLocaleString([],windowMs>31*86400000?{month:'short',year:'2-digit'}:windowMs>86400000?{month:'short',day:'numeric'}:windowMs<=300000?{minute:'2-digit',second:'2-digit'}:{hour:'2-digit',minute:'2-digit'});
  let controller,historyController,historyPair,sequence=0,pending=false,windowMs=86400000,lastPlot,stopped=false;
  const active=()=>!stopped&&svg.isConnected!==false;
  let chartStyle='candles';
  const ns='http://www.w3.org/2000/svg';
  function node(tag,attrs={},text){const el=root.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;}
  function ranges(){return getDraft().nodes.filter(item=>item.type==='signal.price'&&Number.isFinite(item.minPriceUsd)&&Number.isFinite(item.maxPriceUsd));}
  function render(){
    if(!active())return;
    const pair=getPair(),data=state.snapshot();
    const summary=$('chart-summary');summary?.replaceChildren();
    const legacyCandles=[...new Map([...data.candles,...sampledCandles(data.points)].map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
    const market=historyFeed?.snapshot(pair.id)??{points:data.points,candles:legacyCandles,interval:60000};
    const recent=market.candles.at(-1),quote=market.points.at(-1);
    const last=recent&&(!quote||recent.end>quote.time)&&!historyFeed?{price:recent.close,time:recent.end,oracleTime:recent.end,source:'COINBASE'}:quote;
    const timeline=historyFeed?market.points:market.candles.map(c=>({time:c.end}));
    const {start,end}=historyFeed?{start:Math.max(now()-windowMs,market.candles[0]?.start??now()-windowMs),end:now()}:chartTimeRange(timeline,windowMs,now());
    const span=Math.max(1000,end-start);
    $('chart-pair').textContent=`${pair.base.reference} / USD`;$('chart-network').textContent=`${pair.base.symbol}/${pair.quote.symbol} · ${pair.network.name}`;
    $('chart-last-price').textContent=last?money(last.price):'—';
    if(data.cached&&['loading','cached',undefined].includes($('chart-feed-status').dataset.state)){$('chart-feed-status').textContent='CACHED · REFRESHING';$('chart-feed-status').dataset.state='cached';}
    $('chart-agent-status').textContent=data.message;$('chart-ai-count').textContent=`${data.inferences} completed AI execution${data.inferences===1?'':'s'} in latest run`;
    $('chart-targets').replaceChildren();
    for(const range of ranges()){
      const el=root.createElement('span');el.className='chart-target';el.textContent=`Target ${money(range.minPriceUsd)}–${money(range.maxPriceUsd)}`;$('chart-targets').append(el);
    }
    $('chart-activity').replaceChildren();
    for(const event of data.events.slice(-4).reverse()){
      const li=root.createElement('li'),time=root.createElement('time'),text=root.createElement('span');time.textContent=clock(event.time);text.textContent=event.message;li.append(time,text);$('chart-activity').append(li);
    }
    const position=$('chart-position'),pnl=$('chart-pnl'),note=$('chart-position-note');
    if(data.position){
      const pos=data.position;
      position.textContent=pos.quantity>1e-9?`PAPER LONG · ${pos.quantity.toFixed(8)} ${pair.base.symbol} · Entry ${money(pos.entryPrice)}`:'PAPER · FLAT';
      pnl.textContent=`Realized ${money(pos.realizedPnl)}${last?` · Unrealized ${money(pos.quantity*last.price-pos.cost)}`:''}`;
      note.textContent='Simulated position · fees included in P/L · marked against the latest chart quote.';
    }else if(data.livePosition){
      position.textContent=`LIVE · ${data.livePosition.confirmed} confirmed fill(s) · ${data.livePosition.pending} pending order(s)`;pnl.textContent='Wallet position / P&L not reported';note.textContent='Live markers show confirmed fills or pending orders. Wallet holdings and actual fill prices are not supplied by this feed.';
    }else{position.textContent='No active position data';pnl.textContent='';note.textContent='Start a strategy to see its position and entry/exit markers.';}
    svg.replaceChildren();lastPlot=undefined;
    const rect=svg.getBoundingClientRect(),W=Math.max(300,rect.width||1000),H=Math.max(120,Math.min(360,rect.height||360)),L=12,R=W-92,T=16,B=H-32;
    svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    svg.setAttribute('aria-label',`${chartStyle==='points'?'Point':chartStyle==='line'?'Line':'Candlestick'} chart for ${pair.base.reference}/USD${last?`, latest ${money(last.price)}`:''}, with strategy targets and entry/exit markers`);
    if(!last||!market.candles.length){$('chart-observation').textContent=historyFeed?'Loading market history…':'No saved history for this market. Waiting for a live price.';svg.append(node('text',{x:W/2,y:H/2,'font-size':12,'text-anchor':'middle',fill:'#556277'},'Waiting for a live price…'));return;}
    const raw=market.candles.filter(c=>c.end>=start);
    const view=historyFeed?chartCandles(raw,market.interval,Math.max(12,Math.floor((R-L)/11))):{candles:raw,interval:60000,carried:0};
    const candles=view.candles,entry=data.position?.entryPrice;
    if(!candles.length)return;
    const points=historyFeed?candles.map(c=>({time:Math.min(c.end-1,last.time),price:c.close})):market.points.filter(p=>p.time>=start);
    let low=Math.min(...candles.map(c=>c.low),entry??Infinity),high=Math.max(...candles.map(c=>c.high),entry??-Infinity);
    const padding=Math.max((high-low)*0.1,last.price*0.0002);low=Math.max(0,low-padding);high+=padding;
    const x=time=>L+(time-start)/span*(R-L),y=price=>B-(price-low)/(high-low)*(B-T);
    lastPlot={points,candles,x,y,L,R,T,B,W,H};
    const rows=H<200?3:5,columns=W<500?2:4;
    for(let i=0;i<=rows;i++){
      const yy=T+(B-T)*i/rows,value=high-(high-low)*i/rows;
      svg.append(node('line',{x1:L,x2:R,y1:yy,y2:yy,stroke:'#dfe5ee'}),node('text',{x:R+12,y:yy+4,fill:'#556277','font-size':12},money(value)));
    }
    for(let i=0;i<=columns;i++){
      const xx=L+(R-L)*i/columns;
      svg.append(node('line',{x1:xx,x2:xx,y1:T,y2:B,stroke:'#edf0f5'}),node('text',{x:xx,y:B+24,fill:'#556277','font-size':11,'text-anchor':i===0?'start':i===columns?'end':'middle'},axisTime(start+span*i/columns)));
    }
    for(const range of ranges()){
      if(range.maxPriceUsd<low||range.minPriceUsd>high)continue;
      const top=y(Math.min(high,range.maxPriceUsd)),bottom=y(Math.max(low,range.minPriceUsd));
      svg.append(node('rect',{x:L,y:top,width:R-L,height:Math.max(1,bottom-top),fill:'#4e8ffc','fill-opacity':0.13}),node('line',{x1:L,x2:R,y1:top,y2:top,stroke:'#568bd6','stroke-dasharray':'5 5'}));
    }
    const color=source=>source==='FLASH'?'#148568':'#2458d3';
    const width=Math.min(22,Math.max(historyFeed?6:2,view.interval/span*(R-L)*0.7));
    if(chartStyle==='line') svg.append(node('path',{d:points.map((p,i)=>`${i?'L':'M'}${x(p.time)},${y(p.price)}`).join(' '),fill:'none',stroke:'#2458d3','stroke-width':2}));
    if(chartStyle==='points') for(const p of points) svg.append(node('circle',{cx:x(p.time),cy:y(p.price),r:2.5,fill:'#2458d3'}));
    if(chartStyle==='candles') for(const candle of candles){
      const cx=Math.max(L,Math.min(R,x((Math.max(start,candle.start)+Math.min(end,candle.end))/2))),up=candle.close>=candle.open;
      const fill=historyFeed?(candle.observations===0?'#758299':up?'#148568':'#c9465e'):candle.source==='CHAINLINK'?'#7aa8ed':up?'#12c7b4':'#ef5e77';
      const body=Math.max(historyFeed?3:1.5,Math.abs(y(candle.open)-y(candle.close)));
      const bar=node('rect',{x:cx-width/2,y:(y(candle.open)+y(candle.close))/2-body/2,width,height:body,fill});
      bar.append(node('title',{},`${clock(candle.start)} · Open ${money(candle.open)} · High ${money(candle.high)} · Low ${money(candle.low)} · Close ${money(candle.close)}${candle.carried?` · ${candle.carried} carried interval(s)`:''}`));
      svg.append(node('line',{x1:cx,x2:cx,y1:y(candle.high),y2:y(candle.low),stroke:fill,'stroke-width':1.5}),bar);
    }
    if(entry){svg.append(node('line',{x1:L,x2:R,y1:y(entry),y2:y(entry),stroke:'#f6c85b','stroke-dasharray':'6 4'}),node('text',{x:L+8,y:y(entry)-7,fill:'#f6c85b','font-size':11},`PAPER ENTRY ${money(entry)}`));}
    svg.append(node('line',{x1:L,x2:R,y1:y(last.price),y2:y(last.price),stroke:color(last.source),'stroke-dasharray':'3 5','stroke-opacity':0.6}),node('circle',{cx:x(last.time),cy:y(last.price),r:4,fill:color(last.source)}));
    for(const mark of data.markers){
      if(mark.time<start||mark.time>end||mark.price<low||mark.price>high)continue;
      const mx=x(mark.time),my=y(mark.price),sell=mark.side==='SELL';
      const el=node('polygon',{points:sell?`${mx-7},${my-12} ${mx+7},${my-12} ${mx},${my}`:`${mx-7},${my+12} ${mx+7},${my+12} ${mx},${my}`,fill:sell?'#f05b72':'#f6c85b',stroke:'#0b1727','stroke-width':1});svg.append(node('text',{x:mx,y:my+(sell?-17:26),'text-anchor':'middle',fill:sell?'#f05b72':'#f6c85b','font-size':10},mark.label));el.append(node('title',{},`${clock(mark.time)} · ${mark.label} · ${money(mark.price)}`));svg.append(el);
    }
    const period=view.interval>=86400000?`${view.interval/86400000}d`:view.interval>=3600000?`${view.interval/3600000}h`:`${view.interval/60000}m`;
    $('chart-observation').textContent=historyFeed?`Coinbase · ${period} candles · Updated ${new Date(last.time).toLocaleTimeString()} · ${view.carried?`${view.carried} missing intervals carried forward at the previous close`:'Continuous view'} · Refreshes every 5s`:`${candles.length} one-minute candles · ${data.candles.length?'Coinbase USD history + ':''}${points.length} ${data.cached?'cached':'live'} quote observations · ${last.source==='FLASH'?'Flash quote':last.source==='COINBASE'?'Historical close':'Chainlink oracle'} updated ${clock(last.oracleTime)}`;
    if(summary){
      const open=candles[0].open,change=(last.price/open-1)*100;
      summary.replaceChildren();
      for(const [label,value] of [['Open',money(open)],['High',money(Math.max(...candles.map(c=>c.high)))],['Low',money(Math.min(...candles.map(c=>c.low)))],['Change',`${change>=0?'+':''}${change.toFixed(2)}%`]]){
        const item=root.createElement('span'),name=root.createElement('span'),number=root.createElement('strong');name.textContent=label;number.textContent=value;item.append(name,number);summary.append(item);
      }
    }

  }
  async function preload(){
    const pairId=getPair().id;if(historyFeed||!active()||historyPair===pairId)return;
    historyPair=pairId;historyController?.abort();const current=historyController=new AbortController();
    const status=$('chart-history-status');
    if(status)status.textContent='Loading recent Coinbase USD candles…';
    try{
      const response=await request(`/api/chart-history?pair=${encodeURIComponent(pairId)}`,{cache:'no-store',signal:AbortSignal.any([current.signal,AbortSignal.timeout(12000)])}),payload=await response.json();
      if(!active()||historyController!==current||getPair().id!==pairId)return;
      if(!response.ok||!payload.ok||!state.history(payload.data))throw new Error('Historical data unavailable');
      if(status)status.textContent='Coinbase USD reference history. Live quotes use Flash / Chainlink.';
      if(!state.snapshot().points.length){$('chart-feed-status').textContent='HISTORICAL · REFRESHING';$('chart-feed-status').dataset.state='cached';}
      render();
    }catch{if(active()&&historyController===current&&status)status.textContent='Historical candles unavailable. Saved candles and live quotes remain available.';}
  }
  async function refresh(){
    if(!active())return;
    const pairId=getPair().id;
    if(state.select(pairId)){sequence++;controller?.abort();pending=false;$('chart-feed-status').textContent='CONNECTING';$('chart-feed-status').dataset.state='loading';render();}
    if(pending)return;pending=true;const current=++sequence;controller=new AbortController();
    try{
      if(historyFeed){
        await historyFeed.refresh(getPair(),windowMs,controller.signal);
        if(!active()||current!==sequence||getPair().id!==pairId)return;
        const stale=now()-historyFeed.snapshot(pairId).points.at(-1).time>120000;
        $('chart-feed-status').textContent=stale?'STALE · COINBASE':'LIVE · COINBASE';
        $('chart-feed-status').dataset.state=stale?'error':'live';
      }else{
        const response=await request(`/api/chart-price?pair=${encodeURIComponent(pairId)}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}),payload=await response.json();
        if(!active()||current!==sequence||getPair().id!==pairId)return;
        if(!response.ok||!payload.ok||!state.observe(payload.data,now()))throw new Error('Live chart price is unavailable.');
        $('chart-feed-status').textContent=payload.data.source==='FLASH'?'LIVE · FLASH QUOTE':'CHAINLINK · FALLBACK';
        $('chart-feed-status').dataset.state=payload.data.source==='FLASH'?'live':'fallback';
      }
      render();
    }catch(error){if(active()&&current===sequence){$('chart-feed-status').textContent='PRICE UNAVAILABLE';$('chart-feed-status').dataset.state='error';$('chart-observation').textContent='Fresh price unavailable. Keeping the last verified chart and retrying automatically.';}}
    finally{if(current===sequence)pending=false;}
  }
  const listeners=new AbortController();
  const Observer=root.defaultView?.ResizeObserver;
  const resize=Observer?new Observer(render):undefined;
  resize?.observe(svg);
  for(const button of root.querySelectorAll('[data-chart-window]'))button.addEventListener('click',()=>{
    const range=button.dataset.chartWindow;
    windowMs=range==='max'?now()-Date.UTC(2015,0,1):range==='ytd'?now()-Date.UTC(new Date(now()).getUTCFullYear(),0,1):Number(range)*60000;
    sequence++;controller?.abort();pending=false;
    $('chart-feed-status').textContent='LOADING RANGE';$('chart-feed-status').dataset.state='loading';
    for(const item of root.querySelectorAll('[data-chart-window]'))item.setAttribute('aria-pressed',String(item===button));render();void refresh();
  },{signal:listeners.signal});
  $('chart-style')?.addEventListener('change',event=>{chartStyle=event.target.value;render();},{signal:listeners.signal});
  svg.addEventListener('pointermove',event=>{
    if(!lastPlot)return;
    const rect=svg.getBoundingClientRect(),xx=(event.clientX-rect.left)*lastPlot.W/rect.width;
    const candle=lastPlot.candles.reduce((a,b)=>Math.abs(lastPlot.x((a.start+a.end)/2)-xx)<Math.abs(lastPlot.x((b.start+b.end)/2)-xx)?a:b);
    $('chart-hover').textContent=`${clock(candle.start)} · Open ${money(candle.open)} · High ${money(candle.high)} · Low ${money(candle.low)} · Close ${money(candle.close)}${candle.carried?` · ${candle.carried} carried interval(s)`:''}`;
  },{signal:listeners.signal});
  svg.addEventListener('pointerleave',()=>{$('chart-hover').textContent='Move over the chart to inspect a price';},{signal:listeners.signal});
  state.select(getPair().id);render();
  return {refresh,preload,draftChanged(){if(!active())return;if(state.select(getPair().id)){sequence++;controller?.abort();pending=false;$('chart-feed-status').textContent='CONNECTING';$('chart-feed-status').dataset.state='loading';void preload();void refresh();}render();},activity(event){state.activity(event);render();},resetActivity(){state.resetActivity();render();},stop(){listeners.abort();resize?.disconnect();stopped=true;sequence++;controller?.abort();historyController?.abort();}};
}
