export function mountLivePrices({root=document,getPairs,onSelect,request=fetch}){
  const list=root.querySelector('#live-prices-list'),status=root.querySelector('#live-prices-status');
  let controller,sequence=0,pending=false,currentKey='';
  const currency=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6});
  function element(tag,text,className){const node=root.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
  async function refresh(){
    const unique=new Map();for(const pair of getPairs())if(!unique.has(pair.base.reference))unique.set(pair.base.reference,pair);
    const pairs=[...unique.values()],key=pairs.map(p=>p.id).join(',');
    if(pending&&key===currentKey)return;
    controller?.abort();controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),current=++sequence;
    pending=true;currentKey=key;list.replaceChildren();status.textContent=pairs.length?'Loading live prices…':'No matching assets on this network.';
    const rows=pairs.map(pair=>{
      const row=element(onSelect?'button':'div','','price-row');if(onSelect)row.type='button';row.title=`${pair.base.symbol} on ${pair.network.name}`;
      const label=element('span',pair.base.reference,'price-symbol'),price=element('strong','Loading…','price-value');
      row.append(label,price);if(onSelect)row.addEventListener('click',()=>onSelect(pair));list.append(row);return {pair,price};
    });
    let cursor=0,available=0;
    async function worker(){
      while(cursor<rows.length&&!signal.aborted){
        const {pair,price}=rows[cursor++];
        try{
          const response=await request(`/api/price?pair=${encodeURIComponent(pair.id)}`,{signal,cache:'no-store'}),payload=await response.json(),data=payload.data;
          if(!response.ok||!payload.ok||data?.source!=='CHAINLINK'||data.pairId!==pair.id||data.stale!==false||typeof data.priceUsd!=='string'||!/^\d+\.\d{6}$/.test(data.priceUsd)||Number(data.priceUsd)<=0)throw new Error();
          if(current!==sequence)return;price.textContent=currency.format(Number(data.priceUsd));available++;
        }catch{if(current===sequence)price.textContent='Unavailable';}
      }
    }
    try{await Promise.all([worker(),worker()]);}
    finally{if(current===sequence){pending=false;for(const {price}of rows)if(price.textContent==='Loading…')price.textContent='Unavailable';if(pairs.length)status.textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})} · ${available}/${pairs.length} available · refreshes every 30s`;}}
  }
  return {refresh,stop(){sequence++;pending=false;controller?.abort();}};
}
