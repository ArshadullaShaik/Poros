import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVersion } from '../../../src/integrations/arkiv/records.ts';
import { canonical, contentHash, parseDocument, parseCanonicalRecord, makeStrategyId } from '../../../src/integrations/arkiv/codec.ts';

import { alice, bob, request, fixture, validator } from './fixtures.ts';

test('canonical hashes ignore object insertion order but preserve array order', () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(contentHash({ b: 2, a: 1 }), contentHash({ a: 1, b: 2 }));
  assert.notEqual(contentHash([1, 2]), contentHash([2, 1]));
  assert.notEqual(contentHash({ n: 1 }), contentHash({ n: 2 }));
  assert.notEqual(contentHash('é'), contentHash('e\u0301'));
});
test('non-JSON, cyclic and malformed Unicode inputs are rejected', () => {
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [NaN, Infinity, undefined, 1n, new Date(), cycle, '\ud800', { a: undefined }, new Map()]) {
    assert.throws(() => canonical(value));
  }
});
test('graph validation is required and unknown envelope fields are rejected', () => {
  assert.throws(() => parseDocument(fixture), { code: 'DEPENDENCY_UNAVAILABLE' });
  assert.throws(() => parseDocument({ ...fixture, surprise: true }, validator), { code: 'INVALID_INPUT' });
  assert.throws(() => parseDocument({ ...fixture, graphSchema: 'unknown' }, validator), { code: 'UNSUPPORTED_SCHEMA' });
  assert.equal(parseDocument({ ...fixture, name: '  Hold\t' }, validator).name, 'Hold');
});
test('UTF-8 name limits are enforced without truncation', () => {
  assert.equal(parseDocument({ ...fixture, name: 'é'.repeat(40) }, validator).name.length, 40);
  assert.throws(() => parseDocument({ ...fixture, name: 'é'.repeat(41) }, validator), { code: 'INVALID_INPUT' });
});
test('persisted JSON must be canonical and cannot hide duplicate keys', () => {
  assert.deepEqual(parseCanonicalRecord(new TextEncoder().encode('{"a":1}')), { a: 1 });
  for (const text of ['{"a":1,"a":2}', '{ "a": 1 }', '{"b":2,"a":1}']) {
    assert.throws(() => parseCanonicalRecord(new TextEncoder().encode(text)), { code: 'INTEGRITY_FAILED' });
  }
  assert.throws(() => parseCanonicalRecord(new Uint8Array(65537)), { code: 'PAYLOAD_TOO_LARGE' });
});
test('strategy identity binds creator and original request, never its title', () => {
  assert.equal(makeStrategyId(alice, request), makeStrategyId(alice.toUpperCase().replace('0X', '0x'), request));
  assert.notEqual(makeStrategyId(alice, request), makeStrategyId(bob, request));
  assert.throws(() => makeStrategyId('bad', request), { code: 'INVALID_INPUT' });
  assert.throws(() => makeStrategyId(alice, 'bad'), { code: 'INVALID_INPUT' });
});
test('document, identity and record hashes match independently verified golden literals',()=>{
  const golden=JSON.parse(readFileSync(new URL('../../../arkiv/fixtures/expected-hashes.json',import.meta.url),'utf8'));
  const document=parseDocument(golden.document,validator);
  assert.equal(canonical(document),golden.canonicalDocument);
  assert.equal(contentHash(document),golden.contentHash);
  assert.equal(makeStrategyId(golden.creator,golden.requestId),golden.strategyId);
  assert.equal(buildVersion(golden.creator,golden.requestId,document).recordHash,golden.recordHash);
});
