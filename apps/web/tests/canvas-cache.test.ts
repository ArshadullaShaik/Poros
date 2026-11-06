import test from 'node:test';
import assert from 'node:assert/strict';
import {readCanvas, saveCanvas} from '../../../src/features/builder/demo/canvas-cache.js';
import {priceStrategy} from '../../../src/features/builder/market/config.ts';

function browser() {
  const values = new Map<string, string>();
  return {localStorage: {getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => {values.set(key, value);}}};
}
const snapshot = () => ({draft: structuredClone(priceStrategy), positions: [['price', {x: 120, y: 240}]], selected: 'price', dirty: true, forkSource: 'original-version'});

test('restores the draft, moved blocks, selection and fork attribution after navigation', () => {
  const host = browser();
  assert.equal(readCanvas(host), undefined);
  assert.equal(saveCanvas(snapshot(), host), true);
  const restored = readCanvas(host)!;
  assert.equal(restored.draft.name, 'WETH price range example');
  assert.deepEqual(restored.positions, [['price', {x: 120, y: 240}]]);
  assert.equal(restored.selected, 'price');
  assert.equal(restored.forkSource, 'original-version');
  assert.equal(restored.dirty, true);
});

test('preserves disconnected and empty canvases instead of requiring executable strategies', () => {
  const host = browser(), state = snapshot();
  state.draft.edges = [];
  assert.equal(saveCanvas(state, host), true);
  assert.deepEqual(readCanvas(host)!.draft.edges, []);
  state.draft.nodes = []; state.positions = []; state.draft.name = '';
  assert.equal(saveCanvas(state, host), true);
  assert.deepEqual(readCanvas(host)!.draft.nodes, []);
  assert.equal(readCanvas(host)!.draft.name, '');
});

test('ignores corrupt or unsupported saved state without crashing the builder', () => {
  const host = browser();
  for (const raw of ['{', 'null', JSON.stringify({...snapshot(), draft: {nodes: []}}), JSON.stringify({...snapshot(), positions: [['price', {x: 'wrong', y: 0}]]}), JSON.stringify({...snapshot(), draft: {...priceStrategy, nodes: [{id: 'bad', type: 'unsupported'}]}})]) {
    host.localStorage.setItem('poros.canvas.v1', raw);
    assert.equal(readCanvas(host), undefined);
  }
});

test('reports failed writes so navigation can still protect an unsaved canvas', () => {
  const host = {get localStorage(): Storage {throw new Error('Storage blocked');}};
  assert.equal(saveCanvas(snapshot(), host), false);
  assert.equal(readCanvas(host), undefined);
  const quota = {localStorage: {getItem: () => null, setItem() {throw new Error('Quota exceeded');}}};
  assert.equal(saveCanvas(snapshot(), quota), false);
});

test('unrestorable edits never replace the last recoverable canvas or count as saved', () => {
  const host = browser();
  assert.equal(saveCanvas(snapshot(), host), true);
  const state = snapshot();
  state.draft.edges[0]!.source = 'missing-block';
  assert.equal(saveCanvas(state, host), false);
  assert.equal(readCanvas(host)!.draft.edges[0].source, 'price');
});
