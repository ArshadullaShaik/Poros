import assert from "node:assert/strict";
import test from "node:test";
import { validateStrategy } from "../../src/features/builder/index.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

const cases: [string, (draft: any) => void, string][] = [
  ["empty graph", d => { d.nodes = []; d.edges = []; }, "$.nodes"],
  ["duplicate node IDs", d => { d.nodes[1].id = d.nodes[0].id; }, "$.nodes[1].id"],
  ["duplicate edge IDs", d => { d.edges[1].id = d.edges[0].id; }, "$.edges[1].id"],
  ["dangling source", d => { d.edges[0].source = "missing"; }, "$.edges[0].source"],
  ["dangling target", d => { d.edges[0].target = "missing"; }, "$.edges[0].target"],
  ["cycle", d => { d.edges.push({id: "cycle", source: "buy", target: "buy-signal"}); }, "$.edges[4]"],
  ["unguarded action", d => { d.edges[0].target = "buy"; }, "$.edges[0]"],
  ["disconnected node", d => { d.nodes.push({id: "orphan", type: "guard.risk"}); }, "$.nodes[6]"],
  ["missing guard", d => { d.nodes.splice(1, 1); }, "$.edges[0].target"],
  ["duplicate connection", d => { d.edges.push({...d.edges[0], id: "duplicate"}); }, "$.edges[4]"],
  ["branching execution", d => { d.edges.push({id: "branch", source: "buy-guard", target: "sell"}); }, "$.nodes[1]"],
];
for (const [name, mutate, path] of cases) {
  test(`rejects ${name}`, () => {
    const draft = structuredClone(rsiStrategy);
    mutate(draft);
    const result = validateStrategy(draft, fixtureContext);
    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.issues.some(issue => issue.path === path), JSON.stringify(result.issues));
  });
}

test("allows a single complete buy chain", () => {
  const draft = structuredClone(rsiStrategy);
  draft.nodes = draft.nodes.slice(0, 3);
  draft.edges = draft.edges.slice(0, 2);
  assert.equal(validateStrategy(draft, fixtureContext).valid, true);
});

test("reports the affected node ID for a disconnected action", () => {
  const draft = structuredClone(rsiStrategy);
  draft.edges.pop();
  const result = validateStrategy(draft, fixtureContext);
  assert.equal(result.valid, false);
  if (!result.valid) assert.ok(result.issues.some(issue => issue.nodeId === "sell"));
});
