import test from 'node:test';
import assert from 'node:assert/strict';
import {strategyPostBody,strategyQuestions,mountStrategyQuestions} from '../src/strategy-post.ts';
import {tradingPairs} from '../../../src/features/builder/market/config.ts';

function answers(changes: Record<string,string> = {}) {
  const data=new FormData();
  Object.entries({pair:'eth-usdc',side:'both','buy-min':'2000','buy-max':'2109','buy-amount':'10','sell-min':'3000','sell-max':'3000','sell-amount':'20',body:'Price range thesis; prices may never reach these levels.',...changes}).forEach(([key,value])=>data.set(key,value));
  return data;
}

test('both audiences receive exact market, inclusive rules, amounts, and reasoning in the body',()=>{
  for(const audience of ['public','exclusive']) {
    const body=strategyPostBody(answers({audience}));
    assert.match(body,/WETH \/ USDC on Base/);
    assert.match(body,/BUY \$10 USD notional.*\$2000 and \$2109, inclusive/);
    assert.match(body,/SELL \$20 USD notional.*\$3000 and \$3000, inclusive/);
    assert.equal(body.match(/once per run/g)?.length,2);
    assert.match(body,/0.5% \(50 bps\)/);
    assert.match(body,/prices may never reach/);
  }
  assert.doesNotMatch(strategyPostBody(answers({side:'buy','sell-amount':''})),/SELL/);
  assert.doesNotMatch(strategyPostBody(answers({side:'sell','buy-min':''})),/BUY/);
});

test('missing answers, unsupported markets, inverted ranges, unsafe amounts and oversized posts are rejected',()=>{
  const invalid: Record<string,string>[] = [{pair:''},{pair:'invented'},{side:''},{side:'hold'},{body:' '},
    {'buy-min':''},{'buy-max':'0'},{'buy-min':'2200'},{'buy-max':'1000001'},{'sell-min':'NaN'},
    {'buy-amount':''},{'buy-amount':'-1'},{'buy-amount':'20.01'},{'sell-amount':'Infinity'},
    {body:'a'.repeat(4000)},{body:'界'.repeat(1400)}];
  for(const changes of invalid) assert.throws(()=>strategyPostBody(answers(changes)));
});

test('question choices use registered markets without a silent default',()=>{
  const html=strategyQuestions();
  assert.match(html,/name="pair" required><option value="">/);
  assert.match(html,/name="side" required><option value="">/);
  assert.match(html,/data-strategy-error role="alert"/);
  for(const pair of tradingPairs) assert.match(strategyPostBody(answers({pair:pair.id})),new RegExp(`registered pair: ${pair.id}`));
});

test('only selected action fields participate in validation and reset clears visibility',async()=>{
  const handlers: Record<string,()=>void>={};
  const side={value:'',addEventListener:(_name:string,fn:()=>void)=>handlers.change=fn};
  const ranges:Record<string,any>={};
  const groups=['buy','sell'].map(rule=>{
    const input={disabled:false,required:false},toggle={checked:false,disabled:false,parentElement:{hidden:false},addEventListener:(_name:string,fn:()=>void)=>handlers[rule+'-range']=fn};
    const upper={hidden:false,querySelector:()=>input};
    const mode={value:'target',addEventListener:(_name:string,fn:()=>void)=>handlers[rule+'-mode']=fn},targetInput={disabled:false,required:true},target={hidden:false,querySelector:()=>targetInput};
    const amount={value:'0.10',attrs:{} as Record<string,string>,setAttribute(key:string,value:string){this.attrs[key]=value;},addEventListener:(_name:string,fn:()=>void)=>handlers[rule+'-amount']=fn},output={textContent:''};
    ranges[rule]={input,toggle,upper,amount,output,mode,target,targetInput};
    return {dataset:{rule},hidden:false,disabled:false,querySelector:(selector:string)=>({'[data-price-mode]':mode,'[data-target-price]':target,'[data-range-toggle]':toggle,'[data-range-upper]':upper,'[data-order-amount]':amount,'[data-order-value]':output}[selector])};
  });
  mountStrategyQuestions({elements:{namedItem:(name:string)=>name==='side'?side:{value:'',addEventListener(){}}},querySelectorAll:(selector:string)=>selector==='[data-rule]'?groups:[],addEventListener:(name:string,fn:()=>void)=>handlers[name]=fn} as any);
  assert.ok(groups.every(group=>group.disabled&&group.hidden));
  side.value='buy';handlers.change!();assert.deepEqual(groups.map(group=>group.disabled),[false,true]);
  assert.equal(ranges.buy.output.textContent,'$0.10');ranges.buy.amount.value='5.25';handlers['buy-amount']!();assert.equal(ranges.buy.output.textContent,'$5.25');assert.equal(ranges.buy.amount.attrs['aria-valuetext'],'$5.25');
  assert.equal(ranges.buy.input.disabled,true);assert.equal(ranges.buy.upper.hidden,true);
  ranges.buy.toggle.checked=true;handlers['buy-range']!();assert.equal(ranges.buy.input.disabled,false);assert.equal(ranges.buy.input.required,true);assert.equal(ranges.buy.upper.hidden,false);
  ranges.buy.toggle.checked=false;handlers['buy-range']!();assert.equal(ranges.buy.input.disabled,true);
  ranges.buy.mode.value='market';handlers['buy-mode']!();assert.equal(ranges.buy.target.hidden,true);assert.equal(ranges.buy.targetInput.disabled,true);assert.equal(ranges.buy.input.disabled,true);assert.equal(ranges.buy.toggle.parentElement.hidden,true);
  ranges.buy.mode.value='target';handlers['buy-mode']!();assert.equal(ranges.buy.target.hidden,false);assert.equal(ranges.buy.targetInput.disabled,false);assert.equal(ranges.buy.targetInput.required,true);
  side.value='both';handlers.change!();assert.ok(groups.every(group=>!group.disabled&&!group.hidden));
  handlers.reset!();side.value='';await Promise.resolve();assert.ok(groups.every(group=>group.disabled&&group.hidden));
});

function priceForm(request:typeof fetch) {
  const handlers:Record<string,Function>={};
  const pair={value:'eth-usdc',addEventListener:(name:string,fn:Function)=>handlers[name]=fn};
  const prices=Array.from({length:4},()=>({value:'2100',placeholder:'',addEventListener:(name:string,fn:Function)=>handlers['price-'+name]=fn}));
  mountStrategyQuestions({elements:{namedItem:(name:string)=>name==='pair'?pair:{value:'',addEventListener(){}}},querySelectorAll:(selector:string)=>selector==='[data-rule]'?[]:prices,addEventListener(){}} as any,request);
  return {pair,prices,handlers};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('price placeholders show the selected market live USD price without changing entered targets',async()=>{
  const calls:string[]=[];
  const ui=priceForm(async(url:any)=>{calls.push(String(url));const pairId=new URL(String(url),'http://localhost').searchParams.get('pair');return Response.json({ok:true,data:{source:'CHAINLINK',pairId,stale:false,priceUsd:pairId==='eth-usdc'?'2345.123456':'75000.000000'}});});
  await settle();
  assert.ok(ui.prices.every(input=>input.placeholder==='Live price: $2,345.123456'));
  ui.pair.value='btc-usdt';await ui.handlers.change!();
  assert.ok(ui.prices.every(input=>input.placeholder==='Live price: $75,000'));
  await ui.handlers['price-focus']!();assert.equal(calls.length,3);
  assert.ok(ui.prices.every(input=>input.value==='2100'));
});

test('stale, mismatched and failed quotes never appear as live price hints',async()=>{
  for(const data of [{source:'CHAINLINK',pairId:'btc-usdt',stale:false,priceUsd:'75000.000000'},{source:'CHAINLINK',pairId:'eth-usdc',stale:true,priceUsd:'2345.000000'},null]){
    const ui=priceForm(async()=>{if(!data)throw new Error('offline');return Response.json({ok:true,data});});
    await settle();assert.ok(ui.prices.every(input=>input.placeholder==='Live price unavailable'));
  }
});

test('a late quote for a previous market cannot overwrite the selected market placeholder',async()=>{
  let resolve!:(value:Response)=>void;
  const ui=priceForm(async(url:any)=>String(url).includes('eth-usdc')?new Promise<Response>(done=>{resolve=done;}):Response.json({ok:true,data:{source:'CHAINLINK',pairId:'btc-usdt',stale:false,priceUsd:'75000.000000'}}));
  ui.pair.value='btc-usdt';await ui.handlers.change!();
  resolve(Response.json({ok:true,data:{source:'CHAINLINK',pairId:'eth-usdc',stale:false,priceUsd:'2345.000000'}}));
  await settle();assert.ok(ui.prices.every(input=>input.placeholder==='Live price: $75,000'));
  ui.pair.value='';await ui.handlers.change!();assert.ok(ui.prices.every(input=>input.placeholder==='Choose a market first'));
});

test('one target price becomes an exact rule without entering it twice',()=>{
 const data=answers({side:'buy'});data.delete('buy-max');
 assert.match(strategyPostBody(data),/BUY \$10 USD notional.*\$2000 and \$2000, inclusive/);
 data.set('buy-max','2050');assert.match(strategyPostBody(data),/\$2000 and \$2050, inclusive/);
 assert.doesNotMatch(strategyQuestions(),/enter the same value twice/);
});

test('order amount sliders start at ten cents and reject smaller submitted amounts',()=>{
 const html=strategyQuestions();
 assert.match(html,/name="buy-amount" type="range" min="0.10" max="20" step="0.01" value="0.10"/);
 assert.match(strategyPostBody(answers({'buy-amount':'0.10'})),/BUY \$0\.1 USD notional/);
 for(const amount of ['0','0.001','0.09'])assert.throws(()=>strategyPostBody(answers({'buy-amount':amount})),/between \$0\.10 and \$20/);
});

test('market-price buy and sell rules need an amount but no manual target',()=>{
  const data=answers({'buy-price-mode':'market','sell-price-mode':'market','buy-min':'','buy-max':'','sell-min':'','sell-max':''});
  const body=strategyPostBody(data);
  assert.match(body,/BUY \$10 USD notional of WETH at market price/);
  assert.match(body,/SELL \$20 USD notional of WETH at market price/);
  assert.doesNotMatch(body,/between \$/);
  assert.match(body,/once per run/);
  data.set('buy-amount','0');assert.throws(()=>strategyPostBody(data),/amount/);
});

test('market-price mode cannot silently turn an unknown price mode into an immediate order',()=>{
  assert.throws(()=>strategyPostBody(answers({'buy-price-mode':'invented'})),/price mode/i);
});
