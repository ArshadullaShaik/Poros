import assert from "node:assert/strict";
import test from "node:test";
import { editStrategy, importStrategyJson, exportStrategyJson } from "../../src/features/builder/adapters/editor.ts";
import { validateStrategy } from "../../src/features/builder/index.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

test("adds a block without mutating the original strategy or edit", () => {
  const node = {id: "new-guard", type: "guard.risk"} as const;
  const before = structuredClone(rsiStrategy);
  const result = editStrategy(rsiStrategy, {type: "addNode", node});
  assert.equal(result.nodes.length, 7);
  result.nodes.at(-1)!.id = "changed";
  assert.equal(node.id, "new-guard");
  assert.deepEqual(rsiStrategy, before);
});

test("removing a block removes its attached connections", () => {
  const result = editStrategy(rsiStrategy, {type: "removeNode", nodeId: "buy-guard"});
  assert.equal(result.nodes.length, 5);
  assert.equal(result.edges.length, 2);
  assert.ok(result.edges.every(edge => edge.source !== "buy-guard" && edge.target !== "buy-guard"));
  assert.equal(validateStrategy(result, fixtureContext).valid, false);
});

test("edits RSI settings without mutating the original", () => {
  const result = editStrategy(rsiStrategy, {type: "updateNode", nodeId: "buy-signal", settings: {threshold: 25}});
  assert.equal((result.nodes[0] as {threshold: number}).threshold, 25);
  assert.equal((rsiStrategy.nodes[0] as {threshold: number}).threshold, 30);
  assert.equal(validateStrategy(result, fixtureContext).valid, true);
});

test("connects an incomplete chain and can disconnect it again", () => {
  const disconnected = editStrategy(rsiStrategy, {type: "disconnect", edgeId: "buy-guard-action"});
  assert.equal(disconnected.edges.length, 3);
  assert.equal(validateStrategy(disconnected, fixtureContext).valid, false);
  const restored = editStrategy(disconnected, {type: "connect", edge: {id: "replacement", source: "buy-guard", target: "buy"}});
  assert.equal(validateStrategy(restored, fixtureContext).valid, true);
});

test("rejects duplicate block and connection identifiers", () => {
  assert.throws(() => editStrategy(rsiStrategy, {type: "addNode", node: rsiStrategy.nodes[0]!}), /already exists/i);
  assert.throws(() => editStrategy(rsiStrategy, {type: "connect", edge: {...rsiStrategy.edges[0]!, target: "sell-guard"}}), /already exists/i);
});

test("rejects missing connection endpoints and repeated connections", () => {
  assert.throws(() => editStrategy(rsiStrategy, {type: "connect", edge: {id: "new", source: "missing", target: "buy"}}), /does not exist/i);
  assert.throws(() => editStrategy(rsiStrategy, {type: "connect", edge: {...rsiStrategy.edges[0]!, id: "new"}}), /already exists/i);
});

test("rejects stale block edits and settings belonging to another block type", () => {
  assert.throws(() => editStrategy(rsiStrategy, {type: "updateNode", nodeId: "missing", settings: {threshold: 10}}), /does not exist/i);
  assert.throws(() => editStrategy(rsiStrategy, {type: "updateNode", nodeId: "buy-guard", settings: {threshold: 10}}), /setting/i);
});

test("imports and exports valid JSON through the same validator", () => {
  const text = exportStrategyJson(rsiStrategy, fixtureContext);
  const result = importStrategyJson(text, fixtureContext);
  assert.equal(result.valid, true);
  if (result.valid) assert.deepEqual(result.strategy, rsiStrategy);
});

test("malformed JSON returns diagnostics rather than executing or throwing", () => {
  const result = importStrategyJson("alert('run code')", fixtureContext);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.issues[0]?.code, "INVALID_JSON");
});

test("import rejects mismatched networks", () => {
  const draft = structuredClone(rsiStrategy);
  draft.networkId = 1;
  const result = importStrategyJson(JSON.stringify(draft), fixtureContext);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.issues.some(issue => issue.code === "UNSUPPORTED_NETWORK"));
});

test("import bounds UTF-8 bytes rather than only JavaScript string length", () => {
  const result = importStrategyJson("é".repeat(32769), fixtureContext);
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.issues[0]?.code, "INPUT_TOO_LARGE");
});

test("invalid drafts cannot be exported as executable strategy JSON", () => {
  assert.throws(() => exportStrategyJson({...rsiStrategy, edges: []}, fixtureContext), /invalid strategy/i);
});
