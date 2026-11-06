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

export function mountMarketChart({root=document,getPair,getDraft,request=fetch,now=Date.now}){
  let storage;try{storage=root.defaultView?.localStorage;}catch{}
  const $=id=>root.querySelector(`#${id}`),svg=$('market-chart-svg'),state=createChartState({storage,now});
  const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value<1?6:2}).format(value);
  const clock=time=>new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  let controller,historyController,historyPair,sequence=0,pending=false,windowMs=900000,lastPlot,stopped=false;
  const ns='http://www.w3.org/2000/svg';
  function node(tag,attrs={},text){const el=root.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;}
  function ranges(){return getDraft().nodes.filter(item=>item.type==='signal.price'&&Number.isFinite(item.minPriceUsd)&&Number.isFinite(item.maxPriceUsd));}
  function render(){
    const pair=getPair(),data=state.snapshot();
    const allCandles=[...new Map([...data.candles,...sampledCandles(data.points)].map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
    const recent=data.candles.at(-1),quote=data.points.at(-1);
    const last=recent&&(!quote||recent.end>quote.time)?{price:recent.close,time:recent.end,oracleTime:recent.end,source:'COINBASE'}:quote;
    const timeline=allCandles.map(c=>({time:c.end})),{start,end}=chartTimeRange(timeline,windowMs,now()),span=end-start,points=data.points.filter(p=>p.time>=start);
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
    const W=1000,H=360,L=18,R=890,T=20,B=320;
    if(!allCandles.length){$('chart-observation').textContent='Loading recent candles and live prices…';svg.append(node('text',{x:500,y:170,'text-anchor':'middle',fill:'#8d9bb2'},'Loading candlesticks…'));return;}
    const candles=allCandles.filter(c=>c.end>=start),entry=data.position?.entryPrice;
    let low=Math.min(...candles.map(c=>c.low),entry??Infinity),high=Math.max(...candles.map(c=>c.high),entry??-Infinity);
    const padding=Math.max((high-low)*0.12,last.price*0.002);low=Math.max(0,low-padding);high+=padding;
    const x=time=>L+(time-start)/span*(R-L),y=price=>B-(price-low)/(high-low)*(B-T);
    lastPlot={points,candles,x,y,L,R,T,B,W,H};
    for(let i=0;i<=5;i++){
      const yy=T+(B-T)*i/5,value=high-(high-low)*i/5;
      svg.append(node('text',{x:R+12,y:yy+4,fill:'#8d9bb2','font-size':12},money(value)));
    }
    for(let i=0;i<=4;i++){
      const xx=L+(R-L)*i/4;
      svg.append(node('text',{x:xx,y:B+24,fill:'#8d9bb2','font-size':11,'text-anchor':i===0?'start':i===4?'end':'middle'},clock(start+span*i/4)));
    }
    for(const range of ranges()){
      if(range.maxPriceUsd<low||range.minPriceUsd>high)continue;
      const top=y(Math.min(high,range.maxPriceUsd)),bottom=y(Math.max(low,range.minPriceUsd));
      svg.append(node('rect',{x:L,y:top,width:R-L,height:Math.max(1,bottom-top),fill:'#4e8ffc','fill-opacity':0.13}),node('line',{x1:L,x2:R,y1:top,y2:top,stroke:'#568bd6','stroke-dasharray':'5 5'}));
    }
    const color=source=>source==='FLASH'?'#12c7b4':'#7aa8ed';
    const width=Math.min(18,Math.max(2,60000/span*(R-L)*0.65));
    for(const candle of candles){
      const cx=Math.max(L,Math.min(R,x((candle.start+candle.end)/2))),up=candle.close>=candle.open,fill=candle.source==='CHAINLINK'?'#7aa8ed':up?'#12c7b4':'#ef5e77';
      svg.append(node('line',{x1:cx,x2:cx,y1:y(candle.high),y2:y(candle.low),stroke:fill,'stroke-width':1.5}),node('rect',{x:cx-width/2,y:Math.min(y(candle.open),y(candle.close))-0.75,width,height:Math.max(1.5,Math.abs(y(candle.open)-y(candle.close))),fill}));
    }
    if(entry){svg.append(node('line',{x1:L,x2:R,y1:y(entry),y2:y(entry),stroke:'#f6c85b','stroke-dasharray':'6 4'}),node('text',{x:L+8,y:y(entry)-7,fill:'#f6c85b','font-size':11},`PAPER ENTRY ${money(entry)}`));}
    svg.append(node('line',{x1:L,x2:R,y1:y(last.price),y2:y(last.price),stroke:color(last.source),'stroke-dasharray':'3 5','stroke-opacity':0.6}),node('circle',{cx:x(last.time),cy:y(last.price),r:4,fill:color(last.source)}));
    for(const mark of data.markers){
      if(mark.time<start||mark.time>end||mark.price<low||mark.price>high)continue;
      const mx=x(mark.time),my=y(mark.price),sell=mark.side==='SELL';
      const el=node('polygon',{points:sell?`${mx-7},${my-12} ${mx+7},${my-12} ${mx},${my}`:`${mx-7},${my+12} ${mx+7},${my+12} ${mx},${my}`,fill:sell?'#f05b72':'#f6c85b',stroke:'#0b1727','stroke-width':1});svg.append(node('text',{x:mx,y:my+(sell?-17:26),'text-anchor':'middle',fill:sell?'#f05b72':'#f6c85b','font-size':10},mark.label));el.append(node('title',{},`${clock(mark.time)} · ${mark.label} · ${money(mark.price)}`));svg.append(el);
    }
    $('chart-observation').textContent=`${candles.length} one-minute candles · ${data.candles.length?'Coinbase USD history + ':''}${points.length} ${data.cached?'cached':'live'} quote observations · ${last.source==='FLASH'?'Flash quote':last.source==='COINBASE'?'Historical close':'Chainlink oracle'} updated ${clock(last.oracleTime)}${points.length>1&&points.every(point=>point.price===last.price)?' · Price unchanged across these observations':''}`;
  }
  async function preload(){
    const pairId=getPair().id;if(stopped||historyPair===pairId)return;
    historyPair=pairId;historyController?.abort();const current=historyController=new AbortController();
    const status=$('chart-history-status');
    if(status)status.textContent='Loading recent Coinbase USD candles…';
    try{
      const response=await request(`/api/chart-history?pair=${encodeURIComponent(pairId)}`,{cache:'no-store',signal:AbortSignal.any([current.signal,AbortSignal.timeout(12000)])}),payload=await response.json();
      if(stopped||historyController!==current||getPair().id!==pairId)return;
      if(!response.ok||!payload.ok||!state.history(payload.data))throw new Error('Historical data unavailable');
      if(status)status.textContent='History: Coinbase spot USD, a reference for the selected on-chain pair. Gaps are left empty. Live quotes: Flash / Chainlink.';
      if(!state.snapshot().points.length){$('chart-feed-status').textContent='HISTORICAL · REFRESHING';$('chart-feed-status').dataset.state='cached';}
      render();
    }catch{if(!stopped&&historyController===current&&status)status.textContent='Historical candles unavailable for this market. Saved candles and live quotes remain available.';}
  }
  async function refresh(){
    if(stopped)return;
    const pairId=getPair().id;
    if(state.select(pairId)){sequence++;controller?.abort();pending=false;$('chart-feed-status').textContent='CONNECTING';$('chart-feed-status').dataset.state='loading';render();}
    if(pending)return;pending=true;const current=++sequence;controller=new AbortController();
    try{
      const response=await request(`/api/chart-price?pair=${encodeURIComponent(pairId)}`,{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}),payload=await response.json();
      if(current!==sequence||getPair().id!==pairId)return;
      if(!response.ok||!payload.ok||!state.observe(payload.data,now()))throw new Error('Live chart price is unavailable.');
      $('chart-feed-status').textContent=payload.data.source==='FLASH'?'LIVE · FLASH QUOTE':'CHAINLINK · FALLBACK';$('chart-feed-status').dataset.state=payload.data.source==='FLASH'?'live':'fallback';render();
    }catch(error){if(current===sequence){$('chart-feed-status').textContent='PRICE UNAVAILABLE';$('chart-feed-status').dataset.state='error';$('chart-observation').textContent='Fresh price unavailable. Previous observations remain on the chart; gaps are not filled.';}}
    finally{if(current===sequence)pending=false;}
  }
  const listeners=new AbortController();
  for(const button of root.querySelectorAll('[data-chart-window]'))button.addEventListener('click',()=>{
    windowMs=Number(button.dataset.chartWindow)*60000;
    for(const item of root.querySelectorAll('[data-chart-window]'))item.setAttribute('aria-pressed',String(item===button));render();
  },{signal:listeners.signal});
  svg.addEventListener('pointermove',event=>{
    if(!lastPlot)return;
    const rect=svg.getBoundingClientRect(),xx=(event.clientX-rect.left)*lastPlot.W/rect.width;
    const candle=lastPlot.candles.reduce((a,b)=>Math.abs(lastPlot.x((a.start+a.end)/2)-xx)<Math.abs(lastPlot.x((b.start+b.end)/2)-xx)?a:b);
    $('chart-hover').textContent=`${clock(candle.time)} · O ${money(candle.open)} H ${money(candle.high)} L ${money(candle.low)} C ${money(candle.close)} · ${candle.source==='FLASH'?'Flash quotes':candle.source==='COINBASE'?'Coinbase USD history':'Chainlink reference'}`;
  },{signal:listeners.signal});
  svg.addEventListener('pointerleave',()=>{$('chart-hover').textContent='Move over the chart to inspect a price';},{signal:listeners.signal});
  state.select(getPair().id);render();
  return {refresh,preload,draftChanged(){if(state.select(getPair().id)){sequence++;controller?.abort();pending=false;$('chart-feed-status').textContent='CONNECTING';$('chart-feed-status').dataset.state='loading';void preload();void refresh();}render();},activity(event){state.activity(event);render();},resetActivity(){state.resetActivity();render();},stop(){listeners.abort();stopped=true;sequence++;controller?.abort();historyController?.abort();}};
}
