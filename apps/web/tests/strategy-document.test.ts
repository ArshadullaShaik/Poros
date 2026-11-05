import test from 'node:test';
import assert from 'node:assert/strict';
import { builderDocument, validateBuilderDocument } from '../src/strategy-document.ts';
import { strategyReference } from '../src/builder.ts';
import { rsiStrategy } from '../../../src/features/builder/fixtures/rsi-strategy.ts';
import { priceStrategy, strategyForPair } from '../../../src/features/builder/market/config.ts';

test('builder publications use the real validator and bind their envelope to the graph', () => {
  const document = builderDocument(rsiStrategy);
  assert.deepEqual(validateBuilderDocument(document),document);
  for (const change of [{executionChainId:1},{tokenIn:'0x'+'a'.repeat(40)},{name:'Different name'},
    {graph:{...rsiStrategy,edges:[]}},{graph:{...rsiStrategy,riskPolicy:{...rsiStrategy.riskPolicy,paperTradingOnly:false}}}]) {
    assert.throws(()=>validateBuilderDocument({...document,...change}));
  }
  assert.throws(()=>validateBuilderDocument({...document,unknown:true}));
});
test('drag references accept only exact version keys on this application origin',()=>{
  const key = '0x'+'a'.repeat(64);
  assert.equal(strategyReference('http://localhost:4323/?strategy='+key,'http://localhost:4323'),key);
  for (const url of ['https://evil.test/?strategy='+key,'http://localhost:4323/?strategy=bad','http://localhost:4323/other?strategy='+key]) {
    assert.throws(()=>strategyReference(url,'http://localhost:4323'));
  }
});

test('community documents support current price graphs and retain envelope checks',()=>{
 for(const pair of ['eth-usdc','btc-usdt','ethereum-native-eth-usdc']){
  const graph=strategyForPair(pair),document=builderDocument(graph);
  assert.deepEqual(validateBuilderDocument(document),document);
  assert.throws(()=>validateBuilderDocument({...document,executionChainId:999}));
  assert.throws(()=>validateBuilderDocument({...document,graph:{...graph,tokenOut:'0x'+'f'.repeat(40)}}));
  assert.throws(()=>builderDocument({...graph,riskPolicy:{...graph.riskPolicy,paperTradingOnly:false}}));
 }
});
