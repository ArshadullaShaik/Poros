import assert from "node:assert/strict";
import { test } from "node:test";
import { runStrategyAgent } from "../../src/features/builder/ai/zero-g.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

const key = "sk-test-only-not-a-real-key";
const model = (id = "qwen3.7-flash", prompt = "100", completion = "200") => ({
  id, type: "chatbot", provider_count: 1, context_length: 32768, max_completion_tokens: 4096,
  architecture: {input_modalities: ["text"], output_modalities: ["text"]},
  supported_formats: ["openai"], supported_parameters: ["max_tokens", "tools", "response_format"],
  pricing: {prompt, completion}, pricing_usd: {prompt: "0.00000002", completion: "0.00000004"},
});
const changes = {name: "AI RSI", description: "Paper rules", nodes: rsiStrategy.nodes, edges: rsiStrategy.edges};
const output = (patch = {}) => ({explanation: "Buy below 30 and sell above 70.", changeSummary: ["Updated name"], warnings: [], changes, ...patch});
const completion = (answer = output(), patch = {}) => ({
  model: "qwen3.7-flash", choices: [{finish_reason: "stop", message: {content: JSON.stringify(answer)}}],
  x_0g_trace: {request_id: "req-1", provider: "provider-1", billing: {total_cost: "1234"}}, ...patch,
});
function options(input: unknown = {operation: "modify", prompt: "Rename", strategy: rsiStrategy}) {
  return {apiKey: key, input, context: fixtureContext, defaults: rsiStrategy};
}
function transport(answer = completion(), catalog: unknown = {data: [model()]}) {
  const calls: {url: string; init?: RequestInit}[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({url, init});
    return Response.json(url.endsWith("/models") ? catalog : answer);
  };
  return {calls, fetcher};
}

test("chooses the lowest estimated token cost, caps provider prices and keeps the key out of prompts", async () => {
  const fake = transport(completion(), {data: [model("qwen-flash", "1000", "2000"), model(), {...model("0gm-free-image", "0", "0"), type: "text-to-image"}]});
  const result = await runStrategyAgent(options(), fake.fetcher);
  assert.equal(result.proposedDraft.name, "AI RSI");
  assert.equal(result.proposedDraft.strategyId, "fixture-rsi");
  assert.deepEqual(result.proposedDraft.riskPolicy, rsiStrategy.riskPolicy);
  assert.deepEqual(result.inferenceMetadata, {mode: "REAL_0G", model: "qwen3.7-flash", requestId: "req-1", provider: "provider-1", totalCostNeuron: "1234", latencyMs: result.inferenceMetadata.latencyMs});
  const request = fake.calls[1]!;
  const body = JSON.parse(request.init!.body as string);
  assert.equal(body.model, "qwen3.7-flash");
  assert.equal(body.max_tokens, 2048);
  assert.deepEqual(body.response_format, {type: "json_object"});
  assert.equal(request.init!.headers["Authorization"], `Bearer ${key}`);
  assert.equal(request.init!.headers["X-0G-Provider-Sort"], "price");
  assert.equal(request.init!.headers["X-0G-Provider-Max-Price-Usd-Prompt"], "0.02");
  assert.equal(request.init!.headers["X-0G-Provider-Max-Price-Usd-Completion"], "0.04");
  assert.equal(request.init!.headers["X-0G-Provider-Allow-Fallbacks"], "false");
  assert.ok(!JSON.stringify(body).includes(key));
  assert.equal(fake.calls[0]!.init!.headers?.["Authorization"], undefined);
});

test("chooses only the approved Qwen Flash models even when other models are cheaper", async () => {
  const fake=transport(completion(),{data:[model("qwen-free","0","0"),model("0gm-unapproved","0","0"),model("qwen-flash","1000","2000"),model()]});
  const result=await runStrategyAgent(options(),fake.fetcher);
  assert.equal(result.inferenceMetadata.model,"qwen3.7-flash");
  assert.equal(JSON.parse(fake.calls[1]!.init!.body as string).model,"qwen3.7-flash");
});

test("can select the Qwen Flash model when it advertises the required capabilities", async () => {
  const fake=transport(completion(output(),{model:"qwen-flash"}),{data:[{...model(),provider_count:0},model("qwen-flash")]});
  const result=await runStrategyAgent(options(),fake.fetcher);
  assert.equal(result.inferenceMetadata.model,"qwen-flash");
});

test("does not spend on another model family when no compatible Qwen model is available", async () => {
  const fake=transport(completion(),{data:[model("qwen-free","0","0"),{...model(),supported_parameters:[]},{...model("qwen-flash"),supported_parameters:["max_tokens"]}]});
  await assert.rejects(runStrategyAgent(options(),fake.fetcher),{code:"UNAVAILABLE"});
  assert.equal(fake.calls.length,1);
});

test("generation assigns a fresh identity and trusted market instead of taking them from AI", async () => {
  const fake = transport();
  const result = await runStrategyAgent(options({operation: "generate", prompt: "Create RSI rules"}), fake.fetcher);
  assert.notEqual(result.proposedDraft.strategyId, rsiStrategy.strategyId);
  assert.equal(result.proposedDraft.networkId, 31337);
  assert.equal(result.proposedDraft.riskPolicy.paperTradingOnly, true);
  assert.equal(rsiStrategy.name, "Paper RSI example");
});

test("explanation makes no draft and rejects malformed billing rather than inventing provenance", async () => {
  const fake = transport(completion(output({changes: undefined}), {x_0g_trace: {billing: {total_cost: -1}}}));
  const result = await runStrategyAgent(options({operation: "explain", strategy: rsiStrategy}), fake.fetcher);
  assert.equal(result.proposedDraft, undefined);
  assert.equal(result.inferenceMetadata.totalCostNeuron, undefined);
  assert.equal(result.inferenceMetadata.requestId, undefined);
});

test("input errors never reach the provider", async () => {
  for (const input of [null, {operation: "trade"}, {operation: "generate", prompt: " "}, {operation: "generate", prompt: "x".repeat(4001)}, {operation: "generate", prompt: "x", apiKey: key}, {operation: "modify", prompt: "x", strategy: {...rsiStrategy, edges: []}}, {operation: "explain", strategy: {...rsiStrategy, riskPolicy: {...rsiStrategy.riskPolicy, paperTradingOnly: false}}}]) {
    const fake = transport();
    await assert.rejects(runStrategyAgent(options(input), fake.fetcher), {code: "INVALID_INPUT"});
    assert.equal(fake.calls.length, 0);
  }
  for (const apiKey of ["", "mk-admin", "sk-bad\nheader"]) {
    const fake = transport();
    await assert.rejects(runStrategyAgent({...options(), apiKey}, fake.fetcher), {code: "UNAUTHORIZED"});
    assert.equal(fake.calls.length, 0);
  }
});

test("unpriced, unavailable and incompatible catalogs fail before spending", async () => {
  for (const item of [{...model(), pricing: {prompt: "NaN", completion: "0"}}, {...model(), pricing_usd: undefined}, {...model(), provider_count: 0}, {...model(), supported_parameters: []}, {...model(), context_length: 10}, {...model(), max_completion_tokens: 100}]) {
    const fake = transport(completion(), {data: [item]});
    await assert.rejects(runStrategyAgent(options(), fake.fetcher), {code: "UNAVAILABLE"});
    assert.equal(fake.calls.length, 1);
  }
});

test("malformed catalog entries do not hide an available compatible low-cost model", async () => {
  for (const invalid of [{...model(), supported_formats: {}}, {...model(), architecture: {input_modalities: 3}}, {...model(), architecture: {input_modalities: ["text"], output_modalities: {}}}]) {
    const fake = transport(completion(), {data: [invalid, model()]});
    const result = await runStrategyAgent(options(), fake.fetcher);
    assert.equal(result.inferenceMetadata.model, "qwen3.7-flash");
  }
});

test("nested JSON escaping cannot expose a credential in the final proposal", async () => {
  const answer = completion();
  answer.choices[0]!.message.content = JSON.stringify(output({explanation: key})).replace(key, "\\u0073k-test-only-not-a-real-key");
  await assert.rejects(runStrategyAgent(options(), transport(answer).fetcher), {code: "INVALID_OUTPUT"});
});

test("rejects protected-field changes, unsafe graphs, executable output and malformed proposals", async () => {
  for (const answer of [
    output({changes: {...changes, riskPolicy: {...rsiStrategy.riskPolicy, maxNotionalUsd: 999}}}),
    output({changes: {...changes, strategyId: "stolen"}}),
    output({changes: {...changes, edges: []}}),
    output({changes: {...changes, nodes: changes.nodes.map(n => n.type === "action.intent" ? {...n, notionalUsd: 100} : n)}}),
    output({explanation: key}), output({warnings: "no"}), output({changes: null}),
  ]) {
    const fake = transport(completion(answer));
    await assert.rejects(runStrategyAgent(options(), fake.fetcher), {code: "INVALID_OUTPUT"});
  }
  for (const patch of [
    {choices: [{finish_reason: "length", message: {content: JSON.stringify(output())}}]},
    {choices: [{finish_reason: "stop", message: {content: "```json\n{}\n```"}}]},
    {choices: [{finish_reason: "stop", message: {content: JSON.stringify(output()), tool_calls: [{id: "run-code"}]}}]},
    {model: "unexpected-expensive-model"},
  ]) await assert.rejects(runStrategyAgent(options(), transport(completion(output(), patch)).fetcher), {code: "INVALID_OUTPUT"});
});

test("safe HTTP errors preserve status meaning without provider text or retries", async () => {
  for (const [status, code] of [[400, "INVALID_OUTPUT"], [401, "UNAUTHORIZED"], [402, "INSUFFICIENT_COMPUTE_BALANCE"], [403, "FORBIDDEN"], [429, "RATE_LIMITED"], [500, "UNAVAILABLE"], [502, "UNAVAILABLE"], [503, "UNAVAILABLE"]] as const) {
    let spentCalls = 0;
    const fetcher = async (url: string) => {
      if (url.endsWith("/models")) return Response.json({data: [model()]});
      spentCalls++;
      return new Response(key, {status});
    };
    await assert.rejects(runStrategyAgent(options(), fetcher), error => error.code === code && !error.message.includes(key));
    assert.equal(spentCalls, 1);
  }
});

test("rejected requests and mismatched response models have distinct safe explanations", async () => {
  const rejected=transport();
  await assert.rejects(runStrategyAgent(options(),(url,init)=>url.endsWith("/models")?rejected.fetcher(url,init):Promise.resolve(new Response(key,{status:400}))),error=>
    error.code==="INVALID_OUTPUT"&&error.message.includes("HTTP 400")&&!error.message.includes(key));
  await assert.rejects(runStrategyAgent(options(),transport(completion(output(),{model:"other-model"})).fetcher),error=>
    error.code==="INVALID_OUTPUT"&&error.message.includes("different model")&&!error.message.includes(key));
});

test("availability errors identify catalog, model selection, upstream status and network failures", async () => {
  await assert.rejects(runStrategyAgent(options(),async()=>new Response(key,{status:503})),error=>
    error.code==="UNAVAILABLE"&&error.message.includes("model catalog")&&!error.message.includes(key));
  await assert.rejects(runStrategyAgent(options(),transport(completion(),{data:[]}).fetcher),error=>
    error.code==="UNAVAILABLE"&&error.message.includes("No eligible Qwen Flash model"));
  for(const status of [500,502,503]) {
    const fake=transport();
    await assert.rejects(runStrategyAgent(options(),(url,init)=>url.endsWith("/models")?fake.fetcher(url,init):Promise.resolve(new Response(key,{status}))),error=>
      error.code==="UNAVAILABLE"&&error.message.includes(`HTTP ${status}`)&&!error.message.includes(key));
  }
  await assert.rejects(runStrategyAgent(options(),async()=>{throw new Error(key);}),error=>
    error.code==="UNAVAILABLE"&&error.message.includes("network")&&error.message.includes("catalog")&&!error.message.includes(key));
  const fake=transport();
  await assert.rejects(runStrategyAgent(options(),(url,init)=>{
    if(url.endsWith("/models"))return fake.fetcher(url,init);
    throw new Error(key);
  }),error=>error.code==="UNAVAILABLE"&&error.message.includes("network")&&error.message.includes("inference")&&!error.message.includes(key));
});

test("provider failures include a safe request ID, selected model and recognized error code", async () => {
  const fake=transport();let inferenceCalls=0;
  await assert.rejects(runStrategyAgent(options(),(url,init)=>{
    if(url.endsWith("/models"))return fake.fetcher(url,init);
    inferenceCalls++;
    return Promise.resolve(Response.json({request_id:"req_failed-123",error:{code:"provider_error",message:key}},{status:502}));
  }),error=>error.code==="UNAVAILABLE"&&error.message.includes("req_failed-123")&&error.message.includes("provider_error")&&error.message.includes("qwen3.7-flash")&&!error.message.includes(key));
  assert.equal(inferenceCalls,1);
});

test("untrusted provider error fields cannot expose credentials", async () => {
  const fake=transport();
  await assert.rejects(runStrategyAgent(options(),(url,init)=>url.endsWith("/models")?fake.fetcher(url,init):Promise.resolve(Response.json({request_id:`req_${key}`,error:{code:key,message:key}},{status:502}))),error=>
    error.code==="UNAVAILABLE"&&error.message.includes("HTTP 502")&&!error.message.includes(key)&&!error.message.includes("request ID:"));
});

test("malformed and oversized error bodies preserve HTTP failure and use safe request headers", async () => {
  for(const body of ["not JSON","x".repeat(16385)]) {
    const fake=transport();
    await assert.rejects(runStrategyAgent(options(),(url,init)=>url.endsWith("/models")?fake.fetcher(url,init):Promise.resolve(new Response(body,{status:502,headers:{"x-request-id":"0852f405-6c56-40c2-a800-e6fd70785065"}}))),error=>
      error.code==="UNAVAILABLE"&&error.message.includes("HTTP 502")&&error.message.includes("0852f405-6c56-40c2-a800-e6fd70785065"));
  }
});

test("bounds streamed responses and rejects redirects, malformed JSON and network errors safely", async () => {
  for (const response of [new Response("x".repeat(262145)), new Response("{"), new Response(null, {status: 302, headers: {location: "https://evil.invalid"}})]) {
    const fake = transport();
    await assert.rejects(runStrategyAgent(options(), (url, init) => url.endsWith("/models") ? fake.fetcher(url, init) : Promise.resolve(response)), error => ["INVALID_OUTPUT", "UNAVAILABLE"].includes(error.code));
  }
  await assert.rejects(runStrategyAgent(options(), async () => {throw new Error(key);}), error => error.code === "UNAVAILABLE" && !error.message.includes(key));
});

test("aborting an upstream operation returns a timeout without retrying inference", async () => {
  const signal = AbortSignal.abort(new DOMException("Timeout", "TimeoutError"));
  await assert.rejects(runStrategyAgent({...options(), signal}, async (_url, init) => {init!.signal!.throwIfAborted(); throw new Error("unreachable");}), {code: "TIMEOUT"});
});

test("the timeout also interrupts a stalled provider response body", async () => {
  const controller = new AbortController();
  const fake = transport();
  let cancelled = false;
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(runStrategyAgent({...options(), signal: controller.signal}, (url, init) => url.endsWith("/models") ? fake.fetcher(url, init) : Promise.resolve(new Response(new ReadableStream({cancel() {cancelled = true;}})))), {code: "TIMEOUT"});
    assert.equal(cancelled, true);
  } finally { clearTimeout(timer); }
});


test("Qwen catalog tools capability works without JSON-mode or max_tokens capability badges",async()=>{
  const fake=transport(completion(),{data:[{...model(),supported_parameters:["tools","stream"]}]});
  const result=await runStrategyAgent(options(),fake.fetcher);
  assert.equal(result.inferenceMetadata.model,"qwen3.7-flash");
  const body=JSON.parse(fake.calls[1]!.init!.body as string);
  assert.equal(body.response_format,undefined);assert.equal(body.max_tokens,2048);
});
