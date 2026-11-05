const validPrice=value=>typeof value==='string'&&/^\d+\.\d{6}$/.test(value)&&Number(value)>0&&Number(value)<=1000000;
export function createChartState({storage,now=Date.now}={}){
  let pairId,points=[],markers=[],events=[],message='Ready · start a strategy to monitor its targets.',inferences=0,seen=new Set(),cached=false;
  const prefix='poros.chart.v1.',maxAge=3600000;
  function select(id){
    if(id===pairId)return false;
    pairId=id;points=[];markers=[];events=[];seen.clear();inferences=0;cached=false;message='Ready · start a strategy to monitor its targets.';
    try{
      const raw=storage?.getItem(prefix+id);
      if(raw&&raw.length<=150000){
        const entry=JSON.parse(raw),time=now();
        if(entry.pairId===id&&Number.isFinite(entry.savedAt)&&entry.savedAt<=time&&time-entry.savedAt<=maxAge&&Array.isArray(entry.points)&&entry.points.length<=720&&entry.points.every((p,i)=>
          p&&Number.isFinite(p.time)&&p.time<=time&&(i===0||p.time>entry.points[i-1].time)&&Number.isFinite(p.price)&&p.price>0&&p.price<=1000000&&Number.isFinite(p.oracleTime)&&p.oracleTime>0&&p.oracleTime<=p.time+60000&&['FLASH','CHAINLINK'].includes(p.source)
        )){points=entry.points.filter(p=>time-p.time<=maxAge);cached=points.length>0;}
      }
    }catch{/* Browser storage is optional. */}
    return true;
  }
  function save(){
    if(!storage)return;
    try{
      storage.setItem(prefix+pairId,JSON.stringify({pairId,savedAt:now(),points}));
      const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter(key=>key?.startsWith(prefix));
      keys.sort((a,b)=>{try{return JSON.parse(storage.getItem(b)).savedAt-JSON.parse(storage.getItem(a)).savedAt;}catch{return 0;}});
      for(const key of keys.slice(8))storage.removeItem(key);
    }catch{/* Quota or private browsing must not stop live prices. */}
  }
  function observe(data,time){
    if(!['FLASH','CHAINLINK'].includes(data?.source)||data.pairId!==pairId||data.stale!==false||!validPrice(data.priceUsd)||!Number.isFinite(data.observedAtMs)||data.observedAtMs<=0||data.observedAtMs>time+60000||!Number.isFinite(time)||time<(points.at(-1)?.time??0))return false;
    const point={time,price:Number(data.priceUsd),oracleTime:data.observedAtMs,source:data.source};
    if(points.at(-1)?.time===time)points[points.length-1]=point;else points.push(point);
    points=points.slice(-720);cached=false;save();return true;
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
      inferences=Array.isArray(data.inference)?data.inference.length:0;
      for(const fill of data.orders??[])if(data.mode==='PAPER'&&validPrice(fill.priceUsd))marker(`${data.id}:paper:${fill.actionId}:${fill.filledAtMs}`,fill.filledAtMs,Number(fill.priceUsd),`Paper ${fill.side} · $${fill.notionalUsd}`,fill.side);
      for(const order of data.liveOrders??[]){
        const filled=order.status==='ORDER_STATUS_FILLED';
        marker(`${data.id}:live:${order.orderId}:${order.status}`,filled?time:order.submittedAtMs,Number(data.marketData?.priceUsd??points.at(-1)?.price),`${filled?'Flash confirmed':'Submitted'} ${order.side} · reference price`,order.side);
      }
      if(data.walletRequest)marker(`${data.id}:quote:${data.walletRequest.quoteId}`,time,Number(data.walletRequest.effectivePriceUsd),'Wallet approval required · Flash quote',data.walletRequest.side);
    }
    const next=event.message??data?.message;
    if(typeof next==='string'&&next!==message){message=next;events.push({time,message});events=events.slice(-30);}
  }
  return {select,observe,activity,snapshot:()=>({pairId,points:[...points],markers:[...markers],events:[...events],message,inferences,cached})};
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
  let controller,sequence=0,pending=false,windowMs=900000,lastPlot,stopped=false;
  const ns='http://www.w3.org/2000/svg';
  function node(tag,attrs={},text){const el=root.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))el.setAttribute(key,String(value));if(text!==undefined)el.textContent=text;return el;}
  function ranges(){return getDraft().nodes.filter(item=>item.type==='signal.price'&&Number.isFinite(item.minPriceUsd)&&Number.isFinite(item.maxPriceUsd));}
  function render(){
    const pair=getPair(),data=state.snapshot(),last=data.points.at(-1),{start,end}=chartTimeRange(data.points,windowMs,now()),span=end-start,points=data.points.filter(p=>p.time>=start);
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
    svg.replaceChildren();lastPlot=undefined;
    const W=1000,H=360,L=18,R=890,T=20,B=320;
    if(!points.length){$('chart-observation').textContent='No saved history for this market. Waiting for a live price.';svg.append(node('text',{x:500,y:170,'text-anchor':'middle',fill:'#8d9bb2'},'Waiting for the first live price observation…'));return;}
    let low=Math.min(...points.map(p=>p.price)),high=Math.max(...points.map(p=>p.price));
    const padding=Math.max((high-low)*0.12,last.price*0.002);low=Math.max(0,low-padding);high+=padding;
    const x=time=>L+(time-start)/span*(R-L),y=price=>B-(price-low)/(high-low)*(B-T);
    lastPlot={points,x,y,L,R,T,B,W,H};
    for(let i=0;i<=5;i++){
      const yy=T+(B-T)*i/5,value=high-(high-low)*i/5;
      svg.append(node('line',{x1:L,x2:R,y1:yy,y2:yy,stroke:'#1b2a3c'}),node('text',{x:R+12,y:yy+4,fill:'#8d9bb2','font-size':12},money(value)));
    }
    for(let i=0;i<=4;i++){
      const xx=L+(R-L)*i/4;
      svg.append(node('line',{x1:xx,x2:xx,y1:T,y2:B,stroke:'#142336'}),node('text',{x:xx,y:B+24,fill:'#8d9bb2','font-size':11,'text-anchor':i===0?'start':i===4?'end':'middle'},clock(start+span*i/4)));
    }
    for(const range of ranges()){
      if(range.maxPriceUsd<low||range.minPriceUsd>high)continue;
      const top=y(Math.min(high,range.maxPriceUsd)),bottom=y(Math.max(low,range.minPriceUsd));
      svg.append(node('rect',{x:L,y:top,width:R-L,height:Math.max(1,bottom-top),fill:'#4e8ffc','fill-opacity':0.13}),node('line',{x1:L,x2:R,y1:top,y2:top,stroke:'#568bd6','stroke-dasharray':'5 5'}));
    }
    let segment=[],segmentSource;const color=source=>source==='FLASH'?'#12c7b4':'#7aa8ed';
    const draw=()=>{if(segment.length>1)svg.append(node('polyline',{points:segment.join(' '),fill:'none',stroke:color(segmentSource),'stroke-width':2,'stroke-linejoin':'round'}));segment=[];};
    for(let i=0;i<points.length;i++){if(i&&(points[i].time-points[i-1].time>15000||points[i].source!==segmentSource))draw();segmentSource=points[i].source;segment.push(`${x(points[i].time)},${y(points[i].price)}`);}draw();
    svg.append(node('line',{x1:L,x2:R,y1:y(last.price),y2:y(last.price),stroke:color(last.source),'stroke-dasharray':'3 5','stroke-opacity':0.6}),node('circle',{cx:x(last.time),cy:y(last.price),r:4,fill:color(last.source)}));
    for(const mark of data.markers){
      if(mark.time<start||mark.time>end||mark.price<low||mark.price>high)continue;
      const el=node('circle',{cx:x(mark.time),cy:y(mark.price),r:6,fill:mark.side==='SELL'?'#f05b72':'#f6c85b',stroke:'#0b1727','stroke-width':2});el.append(node('title',{},`${clock(mark.time)} · ${mark.label} · ${money(mark.price)}`));svg.append(el);
    }
    $('chart-observation').textContent=`${points.length} ${data.cached?'cached':'live'} observations · auto-fit to collected history · ${last.source==='FLASH'?'Flash quote':'Chainlink oracle'} updated ${clock(last.oracleTime)}${points.length>1&&points.every(point=>point.price===last.price)?' · Price unchanged across these observations':''}`;
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
  for(const button of root.querySelectorAll('[data-chart-window]'))button.addEventListener('click',()=>{
    windowMs=Number(button.dataset.chartWindow)*60000;
    for(const item of root.querySelectorAll('[data-chart-window]'))item.setAttribute('aria-pressed',String(item===button));render();
  });
  svg.addEventListener('pointermove',event=>{
    if(!lastPlot)return;
    const rect=svg.getBoundingClientRect(),xx=(event.clientX-rect.left)*lastPlot.W/rect.width;
    const point=lastPlot.points.reduce((a,b)=>Math.abs(lastPlot.x(a.time)-xx)<Math.abs(lastPlot.x(b.time)-xx)?a:b);
    $('chart-hover').textContent=`${clock(point.time)} · ${money(point.price)} · ${point.source==='FLASH'?'Flash quote':'Chainlink reference'}`;
  });
  svg.addEventListener('pointerleave',()=>{$('chart-hover').textContent='Move over the chart to inspect a price';});
  state.select(getPair().id);render();
  return {refresh,draftChanged(){if(state.select(getPair().id)){sequence++;controller?.abort();pending=false;$('chart-feed-status').textContent='CONNECTING';$('chart-feed-status').dataset.state='loading';void refresh();}render();},activity(event){state.activity(event);render();},stop(){stopped=true;sequence++;controller?.abort();}};
}
