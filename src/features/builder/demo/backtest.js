export function mountBacktest({root=document,getDraft,getPair,getPairs,changeMarket,loadStrategy,request=fetch,onResult}){
 const $=id=>root.querySelector('#'+id);
 let controller,sequence=0,result,loading=false;
 const element=(tag,text,className)=>{const node=root.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const status=text=>{$('backtest-status').textContent=text;};
 const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
 const pct=value=>value===null?'Unavailable':Number(value).toFixed(2)+'%';
 for(const pair of getPairs()) {const option=element('option',`${pair.label} · ${pair.network.name}`);option.value=pair.id;$('backtest-market').append(option);}
 const today=new Date().toISOString().slice(0,10);
 $('backtest-end').value=today;$('backtest-end').max=today;$('backtest-start').max=today;
 $('backtest-start').value=new Date(Date.parse(today)-30*86400000).toISOString().slice(0,10);
 function sync(){
   $('backtest-market').value=getPair().id;$('backtest-slippage').max=String(getDraft().riskPolicy.maxSlippageBps);
   if(Number($('backtest-slippage').value)>getDraft().riskPolicy.maxSlippageBps)$('backtest-slippage').value=String(getDraft().riskPolicy.maxSlippageBps);
   $('backtest-strategy-name').textContent=getDraft().name;
   $('backtest-setup-summary').textContent=`${getPair().label} · $${Number($('backtest-balance').value).toLocaleString('en-US')} virtual · ${Number($('backtest-fee').value)/100}% fee · ${Number($('backtest-slippage').value)/100}% slippage`;
 }
 const presets=[{id:'quick',name:'Quick check',days:7,interval:3600,detail:'7 days · hourly prices'},{id:'standard',name:'Standard test',days:30,interval:86400,detail:'30 days · daily prices'},{id:'long',name:'Long view',days:90,interval:86400,detail:'90 days · daily prices'}];
 function selectPreset(preset){
   sequence++;controller?.abort();$('backtest-run').disabled=loading;$('backtest-view-report').hidden=true;
   $('backtest-end').value=today;$('backtest-start').value=new Date(Date.parse(today)-preset.days*86400000).toISOString().slice(0,10);
   $('backtest-interval').value=String(preset.interval);$('backtest-balance').value='1000';$('backtest-turnover').value='10000';$('backtest-fee').value='10';$('backtest-slippage').value=String(Math.min(25,getDraft().riskPolicy.maxSlippageBps));
   for(const card of $('backtest-presets').children)card.setAttribute('aria-pressed',String(card.value===preset.id));
   status(`${preset.name} ready. Uses your current strategy; choose Run backtest when ready.`);sync();
 }
 for(const preset of presets){
   const card=element('button',undefined,'backtest-preset');card.type='button';card.draggable=true;card.value=preset.id;
   card.append(element('span',preset.days+'D','preset-period'),element('span',preset.name,'preset-name'),element('small',preset.detail));
   card.setAttribute('aria-label',`${preset.name}, ${preset.detail}. Click to use or drag to the test area.`);
   card.addEventListener('click',()=>selectPreset(preset));
   card.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',JSON.stringify({kind:'backtest-preset',id:preset.id}));event.dataTransfer.effectAllowed='copy';});
   $('backtest-presets').append(card);
 }
 const drop=$('backtest-drop');
 drop.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();drop.setAttribute('data-over','true');});
 drop.addEventListener('dragleave',event=>{if(!drop.contains?.(event.relatedTarget))drop.setAttribute('data-over','false');});
 drop.addEventListener('drop',async event=>{
   event.preventDefault();event.stopPropagation();drop.setAttribute('data-over','false');
   if(loading)return;
   const raw=event.dataTransfer.getData('text/plain');
   try{const payload=JSON.parse(raw);if(payload.kind==='backtest-preset'){const preset=presets.find(p=>p.id===payload.id);if(preset)selectPreset(preset);else status('Choose one of the ready-made tests.');return;}}catch{/* Strategy links use the existing verified loaders. */}
   const values=Object.fromEntries(['text/plain','text/uri-list','application/x-poros-member-strategy'].map(type=>[type,event.dataTransfer.getData(type)]));
   if(Object.values(values).some(value=>value.length>65536)){status('Drop a strategy card from the library.');return;}
   loading=true;sequence++;controller?.abort();$('backtest-run').disabled=true;$('backtest-view-report').hidden=true;status('Loading the dropped strategy for review…');
   try{
     if(!loadStrategy||!await loadStrategy({getData:type=>values[type]??''}))throw new Error('The strategy could not be loaded. Use a verified strategy card from your library.');
     sync();status('Strategy ready. Choose a test above, then Run backtest.');
   }catch(error){status(error.message??'The strategy could not be loaded.');}
   finally{loading=false;$('backtest-run').disabled=false;}
 });
 selectPreset(presets[1]);
 $('backtest-market').addEventListener('change',()=>{changeMarket($('backtest-market').value);sync();});
 $('backtest-report-close').addEventListener('click',()=>$('backtest-report-dialog').close());
 $('backtest-view-report').addEventListener('click',()=>$('backtest-report-dialog').showModal());
 function render(data){
   const report=data.report,execution=data.execution,container=$('backtest-report');container.replaceChildren();
   container.append(element('p',`${data.strategy.name} · ${data.parameters.start} to ${data.parameters.end} (exclusive) · UTC`,'small'));
   const metrics=element('dl',undefined,'backtest-metrics');
   for(const [label,value]of [['Total return',pct(report.totalReturnPct)],['Maximum drawdown · candle close',pct(report.maxDrawdownPct)],['Filled orders',report.filledOrders],['Closed trades',report.closedTrades],['Win rate',pct(report.winRatePct)],['Profit factor',report.noLosingTrades?'No losing trades':report.profitFactor===null?'Unavailable':report.profitFactor.toFixed(2)],['Trading costs',money(report.tradingCostsUsd)],['Buy & hold return',pct(report.buyAndHoldReturnPct)],['Final equity',money(Number(execution.summary.finalValueUsd))],['Fees',money(report.feesUsd)],['Slippage cost',money(report.slippageCostUsd)],['Realized P/L',money(report.realizedPnlUsd)]]){
     const item=element('div');item.append(element('dt',label),element('dd',String(value)));metrics.append(item);
   }
   container.append(metrics);
   const series=[execution.equityCurve,report.benchmarkEquityCurve],values=series.flat().map(p=>Number(p.valueUsd)),min=Math.min(data.parameters.initialCashUsd,...values),span=Math.max(1,Math.max(...values)-min);
   const svg=root.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 700 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','Historical equity: blue strategy, gray buy and hold. Values in USD.');
   series.forEach((points,i)=>{const path=root.createElementNS('http://www.w3.org/2000/svg','polyline');path.setAttribute('points',points.map((p,j)=>`${10+j/Math.max(1,points.length-1)*680},${170-(Number(p.valueUsd)-min)/span*160}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',i?'#8490a1':'#355ee8');path.setAttribute('stroke-width','2');svg.append(path);});
   container.append(element('p','Equity in USD · Blue: strategy · Gray: buy and hold','tiny muted'),svg,element('p',report.benchmark,'small muted'),element('p',report.tradeDefinition,'small muted'));
   const provenance=element('p',`${data.dataSource.name} · ${data.dataSource.product} · ${data.dataSource.candles} candles · ${data.dataSource.warmupCandles} warm-up candles · Strategy snapshot ${data.strategyHash}`,'small muted');container.append(provenance,element('p',data.disclosure,'small muted'));
   const assumptions=element('ul');for(const text of execution.assumptions)assumptions.append(element('li',text));container.append(assumptions);
   const details=element('details');details.append(element('summary',`Inspect ${execution.orders.length} fills and ${execution.rejections.length} rejected orders`));
   const scroll=element('div',undefined,'backtest-table-scroll'),table=element('table'),head=element('thead'),header=element('tr');
   for(const label of ['Fill time · UTC','Side','Price · USD','Quantity','Notional · USD','Fee · USD']){const th=element('th',label);th.scope='col';header.append(th);}head.append(header);table.append(head);
   const body=element('tbody');for(const fill of execution.orders){const row=element('tr');for(const value of [new Date(fill.fillTimeMs).toISOString(),fill.side,fill.priceUsd,fill.baseQuantity,fill.notionalUsd,fill.feeUsd])row.append(element('td',String(value)));body.append(row);}table.append(body);scroll.append(table);details.append(scroll);
   if(!execution.orders.length)details.append(element('p','No orders filled in this range.'));
   for(const rejected of execution.rejections)details.append(element('p',`${new Date(rejected.timeMs).toISOString()} · ${rejected.reason}`,'tiny muted'));
   container.append(details);
 }
 $('backtest-form').addEventListener('submit',async event=>{
   event.preventDefault();if(loading)return;controller?.abort();controller=new AbortController();const current=++sequence,strategy=structuredClone(getDraft()),snapshot=JSON.stringify(strategy);
   $('backtest-run').disabled=true;$('backtest-view-report').hidden=true;status('Fetching historical prices and testing your strategy…');
   try{
     const body={strategy,pairId:getPair().id,start:$('backtest-start').value,end:$('backtest-end').value,interval:Number($('backtest-interval').value),initialCashUsd:Number($('backtest-balance').value),maxTurnoverUsd:Number($('backtest-turnover').value),feeBps:Number($('backtest-fee').value),slippageBps:Number($('backtest-slippage').value)};
     const response=await request('/api/backtest',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(50000)]),body:JSON.stringify(body)});
     const payload=await response.json();if(current!==sequence)return;
     if(!response.ok||!payload.ok)throw new Error(payload.error?.message??'Historical backtest is unavailable.');
     if(JSON.stringify(getDraft())!==snapshot)throw new Error('Your strategy changed. Run the backtest again for the current canvas.');
     result=payload.data;render(result);$('backtest-view-report').hidden=false;status('Backtest complete. Simulated results are pinned to this strategy snapshot.');$('backtest-report-dialog').showModal();
     onResult?.(result);
   }catch(error){if(current===sequence)status(error.message??'Historical backtest could not complete.');}
   finally{if(current===sequence)$('backtest-run').disabled=false;}
 });
 sync();
 for(const id of ['backtest-balance','backtest-fee','backtest-slippage'])$(id).addEventListener('change',sync);
 return {sync,stop(){sequence++;controller?.abort();}};
}
