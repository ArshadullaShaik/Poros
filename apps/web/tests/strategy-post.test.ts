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
  const groups=['buy','sell'].map(rule=>({dataset:{rule},hidden:false,disabled:false}));
  mountStrategyQuestions({elements:{namedItem:()=>side},querySelectorAll:()=>groups,addEventListener:(name:string,fn:()=>void)=>handlers[name]=fn} as any);
  assert.ok(groups.every(group=>group.disabled&&group.hidden));
  side.value='buy';handlers.change!();assert.deepEqual(groups.map(group=>group.disabled),[false,true]);
  side.value='both';handlers.change!();assert.ok(groups.every(group=>!group.disabled&&!group.hidden));
  handlers.reset!();side.value='';await Promise.resolve();assert.ok(groups.every(group=>group.disabled&&group.hidden));
});
