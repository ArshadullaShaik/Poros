import assert from 'node:assert/strict';
export const alice = `0x${'11'.repeat(20)}` as const;
export const bob = `0x${'22'.repeat(20)}` as const;
export const request = '00000000-0000-4000-8000-000000000001';
export const fixture = {
  documentSchema: 'strategy-document/1', graphSchema: 'test-only/1', name: 'Hold',
  description: 'Test fixture; no trading semantics.', license: 'MIT', executionChainId: 1,
  tokenIn: alice, tokenOut: bob, category: 'other', graph: { rule: 'hold' },
};
export const validator = (value: unknown) => {
  const d = value as typeof fixture;
  if (d.graphSchema !== 'test-only/1') throw Object.assign(new Error('Unsupported test schema'), { code: 'UNSUPPORTED_SCHEMA' });
  assert.deepEqual(Object.keys(d.graph), ['rule']);
  assert.equal(typeof d.graph.rule, 'string');
  return d as import('../../../src/integrations/arkiv/contracts.ts').StrategyDocumentV1;
};
