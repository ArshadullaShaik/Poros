import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDemoServer } from "../../src/features/builder/demo/server.mjs";
import { marketStrategy as rsiStrategy } from "../../src/features/builder/market/config.ts";

let hits = 0;
let hold: (() => void) | undefined;
let started: (() => void) | undefined;
const receivedKeys: string[] = [];
const fetcher = async (url: string, init?: RequestInit) => {
  hits++;
  if (url.endsWith("/models")) return Response.json({data: [{
    id: "qwen3.7-flash", type: "chatbot", provider_count: 1, context_length: 32768,
    architecture: {input_modalities: ["text"], output_modalities: ["text"]},
    supported_formats: ["openai"], supported_parameters: ["tools", "response_format", "max_tokens"],
    pricing: {prompt: "100", completion: "200"}, pricing_usd: {prompt: "0.00000002", completion: "0.00000004"},
  }]});
  receivedKeys.push(init!.headers["Authorization"]);
  if (started) {
    const notify = started; started = undefined;
    await new Promise<void>(resolve => {hold = resolve; notify();});
  }
  return Response.json({model: "qwen3.7-flash", choices: [{finish_reason: "stop", message: {content: JSON.stringify({
    explanation: "Paper RSI rules", changeSummary: [], warnings: [],
    changes: {name: "Generated", nodes: rsiStrategy.nodes, edges: rsiStrategy.edges},
  })}}]});
};
const server = createDemoServer({fetcher});
let base: string;
before(async () => {
  await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
function post(body: unknown = {operation: "generate", prompt: "Make RSI rules"}, headers = {}) {
  return fetch(`${base}/api/ai`, {method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer sk-tab-one-test-key", "Origin": base, ...headers}, body: JSON.stringify(body)});
}

test("AI route returns a validated proposal using only the current request's key", async () => {
  const response = await post();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.data.proposedDraft.name, "Generated");
  assert.equal(payload.data.inferenceMetadata.mode, "REAL_0G");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const second = await post(undefined, {Authorization: "Bearer sk-tab-two-test-key"});
  assert.equal(second.status, 200);
  assert.deepEqual(receivedKeys.slice(-2), ["Bearer sk-tab-one-test-key", "Bearer sk-tab-two-test-key"]);
  assert.ok(!JSON.stringify(payload).includes("sk-tab-"));
});

test("foreign origins, cross-site requests, invalid keys and invalid bodies never reach 0G", async () => {
  const before = hits;
  for (const [headers, status] of [
    [{Origin: "https://evil.invalid"}, 403], [{Origin: "null"}, 403],
    [{"Sec-Fetch-Site": "cross-site"}, 403], [{"Content-Type": "text/plain"}, 415],
    [{Authorization: ""}, 401], [{Authorization: "Bearer mk-admin-key"}, 401],
  ] as const) assert.equal((await post(undefined, headers)).status, status);
  assert.equal((await post({operation: "generate", prompt: "x".repeat(70000)})).status, 413);
  const malformed = await fetch(`${base}/api/ai`, {method: "POST", headers: {"Content-Type": "application/json", "Authorization": "Bearer sk-tab-one-test-key", Origin: base}, body: "{"});
  assert.equal(malformed.status, 400);
  assert.equal((await post({operation: "trade"})).status, 400);
  assert.equal(hits, before);
});

test("only one paid operation runs at a time and the next request recovers", {timeout: 2000}, async () => {
  const entered = new Promise<void>(resolve => {started = resolve;});
  const first = post();
  await entered;
  try { assert.equal((await post()).status, 429); }
  finally { hold!(); hold = undefined; }
  assert.equal((await first).status, 200);
  assert.equal((await post()).status, 200);
});

test("oversized chunked bodies return 413 without destroying the response or spending", async () => {
  const before = hits;
  const body = new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode(JSON.stringify({operation: "generate", prompt: "x".repeat(70000)}))); controller.close();}});
  const response = await fetch(`${base}/api/ai`, {method: "POST", duplex: "half", headers: {"Content-Type": "application/json", Authorization: "Bearer sk-tab-only-test-key", Origin: base}, body});
  assert.equal(response.status, 413);
  assert.equal((await response.json()).ok, false);
  assert.equal(hits, before);
  assert.equal((await post()).status, 200);
});

test("AI source, server and credentials are not public assets", async () => {
  for (const path of ["/ai/zero-g.ts", "/core/ai/zero-g.ts", "/server.mjs"]) assert.equal((await fetch(base + path)).status, 404);
  assert.equal((await fetch(`${base}/api/ai`)).status, 405);
  assert.equal((await fetch(`${base}/ai.js`)).status, 200);
  const page = await fetch(base);
  assert.ok(page.headers.get("content-security-policy")?.includes("form-action 'self'"));
});
