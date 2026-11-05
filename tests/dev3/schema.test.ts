import assert from "node:assert/strict";
import test from "node:test";
import { validateStrategy } from "../../src/features/builder/index.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

test("valid RSI buy/sell strategy round-trips JSON without changing the input", () => {
  const input = JSON.parse(JSON.stringify(rsiStrategy));
  const before = structuredClone(input);
  const result = validateStrategy(input, fixtureContext);
  assert.equal(result.valid, true);
  if (result.valid) assert.deepEqual(result.strategy, before);
  assert.deepEqual(input, before);
});

const invalidCases: [string, (draft: any) => unknown, string][] = [
  ["null", () => null, "$"],
  ["root array", () => [], "$"],
  ["missing name", d => { delete d.name; return d; }, "$.name"],
  ["empty identifier", d => { d.strategyId = " "; return d; }, "$.strategyId"],
  ["unsupported version", d => { d.schemaVersion = "2"; return d; }, "$.schemaVersion"],
  ["unknown root code", d => { d.code = "alert(1)"; return d; }, "$.code"],
  ["unknown node code", d => { d.nodes[0].code = "eval()"; return d; }, "$.nodes[0].code"],
  ["unknown node type", d => { d.nodes[0].type = "execute.javascript"; return d; }, "$.nodes[0].type"],
  ["bad period", d => { d.nodes[0].period = 1; return d; }, "$.nodes[0].period"],
  ["fractional period", d => { d.nodes[0].period = 2.5; return d; }, "$.nodes[0].period"],
  ["bad comparator", d => { d.nodes[0].comparison = "eq"; return d; }, "$.nodes[0].comparison"],
  ["threshold above 100", d => { d.nodes[0].threshold = 101; return d; }, "$.nodes[0].threshold"],
  ["NaN", d => { d.nodes[0].threshold = NaN; return d; }, "$.nodes[0].threshold"],
  ["Infinity", d => { d.riskPolicy.maxNotionalUsd = Infinity; return d; }, "$.riskPolicy.maxNotionalUsd"],
  ["negative order", d => { d.nodes[2].notionalUsd = -1; return d; }, "$.nodes[2].notionalUsd"],
  ["order above cap", d => { d.nodes[2].notionalUsd = 21; return d; }, "$.nodes[2].notionalUsd"],
  ["unknown side", d => { d.nodes[2].side = "TRANSFER"; return d; }, "$.nodes[2].side"],
  ["missing policy", d => { delete d.riskPolicy; return d; }, "$.riskPolicy"],
  ["zero cap", d => { d.riskPolicy.maxNotionalUsd = 0; return d; }, "$.riskPolicy.maxNotionalUsd"],
  ["excess slippage", d => { d.riskPolicy.maxSlippageBps = 501; return d; }, "$.riskPolicy.maxSlippageBps"],
  ["fractional slippage", d => { d.riskPolicy.maxSlippageBps = 1.5; return d; }, "$.riskPolicy.maxSlippageBps"],
  ["string paper setting", d => { d.riskPolicy.paperTradingOnly = "true"; return d; }, "$.riskPolicy.paperTradingOnly"],
  ["bad address", d => { d.tokenIn = "0x123"; return d; }, "$.tokenIn"],
  ["same pair", d => { d.tokenOut = d.tokenIn; return d; }, "$.tokenOut"],
  ["unsupported network", d => { d.networkId = 1; return d; }, "$.networkId"],
  ["unregistered token", d => { d.tokenOut = "0x0000000000000000000000000000000000000003"; return d; }, "$.tokenOut"],
  ["non-allowlisted token", d => { d.riskPolicy.allowlistedTokenAddresses.pop(); return d; }, "$.riskPolicy.allowlistedTokenAddresses"],
  ["extra unregistered allowance", d => { d.riskPolicy.allowlistedTokenAddresses.push("0x0000000000000000000000000000000000000003"); return d; }, "$.riskPolicy.allowlistedTokenAddresses[2]"],
  ["unknown edge field", d => { d.edges[0].script = "eval"; return d; }, "$.edges[0].script"],
  ["undefined optional field", d => { d.description = undefined; return d; }, "$.description"],
  ["bad creator address", d => { d.creatorWallet = "alice"; return d; }, "$.creatorWallet"],
  ["invalid calendar date", d => { d.metadata = {createdAt: "2026-02-30T00:00:00.000Z"}; return d; }, "$.metadata.createdAt"],
  ["unknown metadata", d => { d.metadata = {script: "eval"}; return d; }, "$.metadata.script"],
  ["invalid tags", d => { d.metadata = {tags: [1]}; return d; }, "$.metadata.tags[0]"],
  ["too many nodes", d => { d.nodes = Array.from({length: 33}, () => d.nodes[0]); return d; }, "$.nodes"],
  ["too many edges", d => { d.edges = Array.from({length: 65}, () => d.edges[0]); return d; }, "$.edges"],
];

for (const [name, mutate, path] of invalidCases) {
  test(`rejects ${name} with a field path`, () => {
    const result = validateStrategy(mutate(structuredClone(rsiStrategy)), fixtureContext);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.ok(result.issues.some(issue => issue.path === path), JSON.stringify(result.issues));
      assert.ok(result.issues.every(issue => issue.code && issue.message));
    }
  });
}

test("rejects missing trusted registry context", () => {
  const result = validateStrategy(rsiStrategy, undefined as never);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.issues.some(issue => issue.path === "$context"));
});

test("accepts boundary values, optional metadata and case-insensitive address lookup", () => {
  const draft = structuredClone(rsiStrategy);
  draft.nodes[0] = {id: "buy-signal", type: "indicator.rsi", period: 2, comparison: "lt", threshold: 0};
  draft.nodes[3] = {id: "sell-signal", type: "indicator.rsi", period: 200, comparison: "gt", threshold: 100};
  draft.riskPolicy.maxSlippageBps = 0;
  draft.creatorWallet = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
  draft.parentVersionId = "published-v1";
  draft.metadata = {tags: ["paper"], createdAt: "2026-11-05T00:00:00.000Z"};
  draft.tokenOut = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
  draft.riskPolicy.allowlistedTokenAddresses[1] = draft.tokenOut.toLowerCase() as typeof draft.tokenOut;
  const context = {...fixtureContext, tokenAddresses: draft.riskPolicy.allowlistedTokenAddresses};
  assert.equal(validateStrategy(draft, context).valid, true);
  draft.riskPolicy.maxSlippageBps = 500;
  assert.equal(validateStrategy(draft, context).valid, true);
});
