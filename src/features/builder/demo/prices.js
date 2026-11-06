export function mountLivePrices({root=document,getPairs,onSelect,request=fetch}){
  const list=root.querySelector('#live-prices-list'),status=root.querySelector('#live-prices-status');
  const copy=root.querySelector('#live-prices-copy'),pause=root.querySelector('#live-prices-pause');
  let controller,sequence=0,pending=false,currentKey='',rows=[];
  const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6});
  function element(tag,text,className){const node=root.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
  function syncCopy(){if(copy)copy.replaceChildren(...rows.map(({row})=>row.cloneNode(true)));}
  pause?.addEventListener('click',()=>{
    const paused=pause.getAttribute('aria-pressed')!=='true';
    pause.setAttribute('aria-pressed',String(paused));
    pause.textContent=paused?'Resume scrolling':'Pause scrolling';
    list.closest('.price-ticker').classList.toggle('paused',paused);
  });
  async function refresh(){
    const unique=new Map();for(const pair of getPairs())if(!unique.has(pair.base.reference))unique.set(pair.base.reference,pair);
    const pairs=[...unique.values()],key=pairs.map(p=>p.id).join(',');
    if(pending&&key===currentKey)return;
    controller?.abort();controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),current=++sequence;
    pending=true;status.textContent=pairs.length?'Refreshing live prices…':'No matching assets on this network.';
    if(key!==currentKey){
      currentKey=key;list.replaceChildren();
      rows=pairs.map(pair=>{
        const row=element(onSelect?'button':'div','','price-row');if(onSelect)row.type='button';row.title=`${pair.base.symbol} on ${pair.network.name}`;
        const label=element('span',pair.base.reference,'price-symbol'),price=element('strong','Loading…','price-value');
        row.append(label,price);if(onSelect)row.addEventListener('click',()=>onSelect(pair));list.append(row);return {pair,price,row};
      });
      syncCopy();
    }
    const currentRows=rows;
    let cursor=0,available=0;
    async function worker(){
      while(cursor<currentRows.length&&!signal.aborted){
        const {pair,price}=currentRows[cursor++];
        try{
          const response=await request(`/api/price?pair=${encodeURIComponent(pair.id)}`,{signal,cache:'no-store'}),payload=await response.json(),data=payload.data;
          if(!response.ok||!payload.ok||data?.source!=='CHAINLINK'||data.pairId!==pair.id||data.stale!==false||typeof data.priceUsd!=='string'||!/^\d+\.\d{6}$/.test(data.priceUsd)||Number(data.priceUsd)<=0)throw new Error();
          if(current!==sequence)return;price.textContent=currency.format(Number(data.priceUsd));available++;syncCopy();
        }catch{if(current===sequence){price.textContent='Unavailable';syncCopy();}}
      }
    }
    try{await Promise.all([worker(),worker()]);}
    finally{if(current===sequence){pending=false;for(const {price}of currentRows)if(price.textContent==='Loading…')price.textContent='Unavailable';syncCopy();if(pairs.length)status.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})} · ${available}/${pairs.length} available · refreshes every 30s`;}}
  }
  return {refresh,stop(){sequence++;pending=false;controller?.abort();}};
}
