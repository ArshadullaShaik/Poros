// Carry-forward bars are display continuity, never market observations or execution input.
export function chartCandles(history, sourceInterval, maxBars) {
  if (!history.length) return {candles:[], interval:sourceInterval, carried:0};
  const first=history[0], last=history.at(-1);
  const target=Math.max(sourceInterval,(last.end-first.start)/Math.max(1,maxBars));
  const interval=[60,120,300,600,900,1800,3600,7200,14400,21600,43200,86400,172800,604800,1209600,2592000,7776000,31536000].map(s=>s*1000).find(step=>step>=target)??Math.ceil(target/sourceInterval)*sourceInterval;
  const byTime=new Map(history.map(c=>[c.time,c])), groups=new Map();
  let previous=first.close, carried=0;
  for(let time=first.time;time<=last.time;time+=sourceInterval){
    const actual=byTime.get(time);
    const candle=actual??{time,start:time,end:time+sourceInterval,open:previous,high:previous,low:previous,close:previous,source:'COINBASE'};
    const bucket=Math.floor(time/interval)*interval, group=groups.get(bucket);
    if(group){group.high=Math.max(group.high,candle.high);group.low=Math.min(group.low,candle.low);group.close=candle.close;group.end=candle.end;group.carried+=actual?0:1;}
    else groups.set(bucket,{...candle,time:bucket,carried:actual?0:1,observations:0});
    if(actual)groups.get(bucket).observations++;
    else carried++;
    previous=candle.close;
  }
  return {candles:[...groups.values()],interval,carried};
}
