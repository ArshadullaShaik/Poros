import assert from "node:assert/strict";
import { test } from "node:test";
import { mountStrategyAi } from "../../src/features/builder/demo/ai.js";
import { rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

function setup(request = async () => Response.json({ok: true, data: {
  explanation: "Paper rules", changeSummary: ["Renamed"], warnings: [],
  proposedDraft: {...rsiStrategy, name: "AI version"},
  inferenceMetadata: {mode: "REAL_0G", model: "cheap", totalCostNeuron: "100"},
}})) {
  const controls = new Map<string, any>();
  const ids = ["ai-open", "ai-close", "ai-dialog", "ai-key-form", "ai-key", "ai-key-status", "ai-use-key", "ai-forget", "ai-form", "ai-operation", "ai-prompt", "ai-run", "ai-status", "ai-result", "ai-explanation", "ai-metadata", "ai-draft", "ai-accept", "ai-discard"];
  for (const id of ids) controls.set(`#${id}`, {value: "", textContent: "", hidden: false, disabled: false, handlers: {}, addEventListener(event: string, handler: Function) {this.handlers[event] = handler;}});
  controls.get("#ai-operation").value = "modify";
  controls.get("#ai-prompt").value = "Rename";
  Object.assign(controls.get("#ai-dialog"), {open: false, showModal() {this.open = true;}, close() {this.open = false; this.handlers.close?.();}});
  let draft = structuredClone(rsiStrategy), applied = 0;
  mountStrategyAi({root: {querySelector: selector => controls.get(selector)}, getDraft: () => draft, applyDraft: next => {draft = next; applied++;}, request});
  const event = async (id: string, name = "click") => controls.get(`#${id}`).handlers[name]({preventDefault() {}});
  const enterKey = async () => {controls.get("#ai-key").value = "sk-tab-only-test-key"; await event("ai-key-form", "submit");};
  return {controls, event, enterKey, get draft() {return draft;}, get applied() {return applied;}, edit() {draft = {...draft, name: "Newer manual draft"};}};
}

test("the toolbar icon opens key settings; closing clears unsaved input and retains the saved key", async () => {
  const ui = setup();
  assert.equal(ui.controls.get("#ai-dialog").open, false);
  await ui.event("ai-open");
  assert.equal(ui.controls.get("#ai-dialog").open, true);
  await ui.enterKey();
  ui.controls.get("#ai-key").value = "sk-unsaved-different-key";
  await ui.event("ai-close");
  assert.equal(ui.controls.get("#ai-dialog").open, false);
  assert.equal(ui.controls.get("#ai-key").value, "");
  await ui.event("ai-open");
  assert.equal(ui.controls.get("#ai-run").disabled, false);
  await ui.event("ai-form", "submit");
  assert.equal(ui.controls.get("#ai-result").hidden, false);
});

test("entering a key clears the input and a proposal waits for explicit acceptance", async () => {
  let sent;
  const ui = setup(async (_url, init) => {sent = init; return Response.json({ok: true, data: {explanation: "Rules", changeSummary: [], warnings: [], proposedDraft: {...rsiStrategy, name: "AI version"}, inferenceMetadata: {mode: "REAL_0G", model: "cheap"}}});});
  assert.equal(ui.controls.get("#ai-run").disabled, true);
  await ui.enterKey();
  assert.equal(ui.controls.get("#ai-key").value, "");
  await ui.event("ai-form", "submit");
  assert.equal(sent.headers.Authorization, "Bearer sk-tab-only-test-key");
  assert.equal(ui.applied, 0);
  assert.equal(ui.controls.get("#ai-result").hidden, false);
  assert.equal(ui.controls.get("#ai-draft").textContent.includes("AI version"), true);
  await ui.event("ai-accept");
  assert.equal(ui.applied, 1);
  assert.equal(ui.draft.name, "AI version");
  await ui.event("ai-forget");
  assert.equal(ui.controls.get("#ai-run").disabled, true);
});

test("acceptance refuses a proposal after a newer manual edit", async () => {
  const ui = setup(); await ui.enterKey(); await ui.event("ai-form", "submit");
  ui.edit(); await ui.event("ai-accept");
  assert.equal(ui.applied, 0);
  assert.equal(ui.draft.name, "Newer manual draft");
  assert.match(ui.controls.get("#ai-status").textContent, /changed/i);
});

test("forgetting the key cancels an in-flight request and ignores late responses", async () => {
  let resolve: (response: Response) => void, signal: AbortSignal;
  const ui = setup(async (_url, init) => {signal = init.signal; return new Promise<Response>(done => {resolve = done;});});
  await ui.enterKey();
  const pending = ui.event("ai-form", "submit");
  assert.equal(ui.controls.get("#ai-run").disabled, true);
  await ui.event("ai-forget");
  assert.equal(signal!.aborted, true);
  resolve!(Response.json({ok: true, data: {proposedDraft: rsiStrategy}}));
  await pending;
  assert.equal(ui.controls.get("#ai-result").hidden, true);
  assert.equal(ui.applied, 0);
});

test("a late response cannot replace a draft edited during inference", async () => {
  let resolve: (response: Response) => void;
  const ui = setup(async () => new Promise<Response>(done => {resolve = done;}));
  await ui.enterKey();
  const pending = ui.event("ai-form", "submit");
  ui.edit();
  resolve!(Response.json({ok: true, data: {explanation: "Late", changeSummary: [], warnings: [], proposedDraft: rsiStrategy, inferenceMetadata: {mode: "REAL_0G", model: "cheap"}}}));
  await pending;
  assert.equal(ui.controls.get("#ai-result").hidden, true);
  assert.match(ui.controls.get("#ai-status").textContent, /changed/i);
});

test("provider errors recover controls and explanation never changes the canvas", async () => {
  let attempts = 0;
  const ui = setup(async () => ++attempts === 1 ? Response.json({ok: false, error: {code: "INSUFFICIENT_COMPUTE_BALANCE", message: "Insufficient balance."}}, {status: 402}) : Response.json({ok: true, data: {explanation: "Rules", changeSummary: [], warnings: [], inferenceMetadata: {mode: "REAL_0G", model: "cheap"}}}));
  await ui.enterKey(); await ui.event("ai-form", "submit");
  assert.match(ui.controls.get("#ai-status").textContent, /Insufficient balance/);
  assert.equal(ui.controls.get("#ai-run").disabled, false);
  ui.controls.get("#ai-operation").value = "explain";
  await ui.event("ai-operation", "change");
  assert.equal(ui.controls.get("#ai-prompt").disabled, true);
  await ui.event("ai-form", "submit");
  assert.equal(ui.controls.get("#ai-accept").hidden, true);
  assert.equal(ui.applied, 0);
});
