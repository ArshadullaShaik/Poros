const endpoint = 'https://api.exchange.coinbase.com/products/';

export function createExchangeFeed(request = fetch, now = Date.now) {
  let selected = '', candles = [], points = [], interval = 60000;
  async function json(url, signal) {
    const response = await request(url, {signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store'});
    if (!response.ok) throw new Error('Coinbase market unavailable (HTTP ' + response.status + ').');
    return response.json();
  }
  return {
    snapshot(pairId) { return {candles: selected.startsWith(pairId + ':') ? candles : [], points: selected.startsWith(pairId + ':') ? points : [], interval}; },
    async refresh(pair, duration, signal) {
      const key = pair.id + ':' + duration, time = now();
      const product = pair.base.reference;
      if (typeof product !== 'string' || !/^[A-Za-z0-9]{2,12}$/.test(product)) throw new Error('Unsupported reference market.');
      const base = endpoint + product + '-USD';
      const seconds = duration <= 3600000 ? 60 : duration <= 86400000 ? 300 : duration <= 31*86400000 ? 21600 : 86400;
      let history = selected === key ? candles.map(c => ({...c})) : [];
      const start = Math.floor((time - duration) / (seconds*1000)) * seconds*1000;
      const refreshFrom = selected === key ? Math.max(start, history.at(-2)?.time ?? start) : start;
      for (let from = refreshFrom; from < time; from += seconds*299000) {
        const to = Math.min(time, from + seconds*299000);
        const rows = await json(base + '/candles?granularity=' + seconds + '&start=' + new Date(from).toISOString() + '&end=' + new Date(to).toISOString(), signal);
        if (!Array.isArray(rows) || rows.length > 301) throw new Error('Invalid Coinbase history.');
        for (const row of rows) {
          if (!Array.isArray(row) || row.length < 5 || !row.slice(0,5).every(Number.isFinite) ||
              row[0] <= 0 || row[0]*1000 > time+60000 || row.slice(1,5).some(p=>p<=0) ||
              row[1] > Math.min(row[3],row[4]) || row[2] < Math.max(row[3],row[4])) throw new Error('Invalid Coinbase candle.');
          if (row[0]*1000 < start || row[0]*1000 > time) continue;
          history.push({time:row[0]*1000,start:row[0]*1000,end:(row[0]+seconds)*1000,low:row[1],high:row[2],open:row[3],close:row[4],source:'COINBASE'});
        }
      }
      const quote = await json(base + '/ticker', signal), price = Number(quote.price), tradeTime = Date.parse(quote.time);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(tradeTime) || tradeTime <= 0 || tradeTime > time+60000) throw new Error('Invalid Coinbase ticker.');
      if(selected===key&&tradeTime<(points.at(-1)?.time??0))throw new Error('Coinbase ticker is behind the last observed trade.');
      history = [...new Map(history.map(c=>[c.time,c])).values()].sort((a,b)=>a.time-b.time);
      const bucket = Math.floor(tradeTime/(seconds*1000))*seconds*1000, last = history.at(-1);
      if (last && bucket === last.time) { last.high=Math.max(last.high,price);last.low=Math.min(last.low,price);last.close=price; }
      else if (!last || bucket > last.time) history.push({time:bucket,start:bucket,end:bucket+seconds*1000,open:price,high:price,low:price,close:price,source:'COINBASE'});
      signal.throwIfAborted();
      selected=key;interval=seconds*1000;candles=history.filter(c => c.end >= time-duration);
      points=candles.map(c=>({time:Math.min(c.end-1,tradeTime),price:c.close,source:'COINBASE',oracleTime:tradeTime}));
      if (points.length) points[points.length-1]={time:tradeTime,price,source:'COINBASE',oracleTime:tradeTime};
    },
  };
}
