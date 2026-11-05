import assert from "node:assert/strict";
import { test } from "node:test";
import { runExecutionAgent } from "../../src/features/builder/execution/agent.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

const apiKey = "sk-execution-test-only-key";
function input() {
  const strategy = structuredClone(rsiStrategy);
  strategy.nodes.forEach(node => {if (node.type === "indicator.rsi") node.period = 2;});
  const candles = [100,90,80,70,80,90,100].map((close,i,closes) => ({openTimeMs:i*60000, closeTimeMs:(i+1)*60000, open: i ? closes[i-1]! : close, close, low: Math.min(close,i?closes[i-1]!:close)-1, high:Math.max(close,i?closes[i-1]!:close)+1}));
  return {strategy, context:fixtureContext, candles, initialCashUsd:100, maxTurnoverUsd:1000, feeBps:0, slippageBps:0};
}
const toolCall = {id:"tool-1", type:"function", function:{name:"run_paper_strategy", arguments:"{}"}};
function fakeTransport(first = {finish_reason:"tool_calls", message:{role:"assistant", content:null, tool_calls:[toolCall]}}, report = {explanation:"The paper strategy bought and sold according to its RSI conditions."}) {
  const sent: any[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url.endsWith("/models")) return Response.json({data:[{id:"qwen3.7-flash",type:"chatbot",provider_count:1,context_length:32768,architecture:{input_modalities:["text"],output_modalities:["text"]},supported_formats:["openai"],supported_parameters:["tools","response_format","max_tokens"],pricing:{prompt:"1",completion:"2"},pricing_usd:{prompt:"0.00000001",completion:"0.00000002"}}]});
    const body = JSON.parse(init!.body as string); sent.push(body);
    return Response.json({model:"qwen3.7-flash",choices:[sent.length===1?first:{finish_reason:"stop",message:{content:JSON.stringify(report)}}]});
  };
  return {sent, fetcher};
}

test("the AI invokes one constrained tool and receives actual paper results before reporting", async () => {
  const fake = fakeTransport(), data = input();
  const result = await runExecutionAgent({apiKey,input:data},fake.fetcher);
  assert.equal(result.agentMode,"REAL_0G");
  assert.equal(result.execution.mode,"PAPER");
  assert.ok(result.execution.orders.length>0);
  assert.equal(result.inference.length,2);
  assert.equal(fake.sent.length,2);
  assert.equal(fake.sent[0].tool_choice.function.name,"run_paper_strategy");
  assert.deepEqual(fake.sent[0].tools[0].function.parameters,{type:"object",properties:{},additionalProperties:false});
  assert.equal(fake.sent[1].messages.at(-1).role,"tool");
  const report = JSON.parse(fake.sent[1].messages.at(-1).content);
  assert.equal(report.mode,"PAPER");
  assert.equal(report.summary.tradeCount,result.execution.orders.length);
  assert.ok(!JSON.stringify(fake.sent).includes(apiKey));
  assert.equal(data.strategy.name,"Paper RSI example");
});

test("the model cannot change amounts, run extra tools or execute wallet instructions", async () => {
  for(const tool_calls of [
    [{...toolCall,function:{name:"send_transaction",arguments:"{}"}}],
    [{...toolCall,function:{name:"run_paper_strategy",arguments:'{"amount":99999}'}}],
    [toolCall,toolCall],
    [{...toolCall,function:{name:"run_paper_strategy",arguments:"null"}}],
  ]) {
    const fake=fakeTransport({finish_reason:"tool_calls",message:{role:"assistant",content:null,tool_calls}});
    await assert.rejects(runExecutionAgent({apiKey,input:input()},fake.fetcher),{code:"INVALID_OUTPUT"});
    assert.equal(fake.sent.length,1);
  }
});

test("execution errors distinguish truncated replies, missing tools and invalid tool arguments", async () => {
  for(const [first,reason] of [
    [{finish_reason:"length",message:{content:null}},"output-token limit"],
    [{finish_reason:"stop",message:{content:"Ready to run."}},"required paper execution tool"],
    [{finish_reason:"tool_calls",message:{tool_calls:[{...toolCall,function:{name:"send_transaction",arguments:"{}"}}]}},"unsupported execution tool"],
    [{finish_reason:"tool_calls",message:{tool_calls:[{...toolCall,function:{name:"run_paper_strategy",arguments:'{"amount":999}'}}]}},"execution tool arguments"],
  ] as const) {
    const fake=fakeTransport(first as any);
    await assert.rejects(runExecutionAgent({apiKey,input:input()},fake.fetcher),error=>
      error.code==="INVALID_OUTPUT"&&error.message.includes(reason)&&!error.message.includes(apiKey)&&!error.message.includes("proposal"));
    assert.equal(fake.sent.length,1);
  }
});

test("invalid input is rejected before spending and stop discards a late tool response", async () => {
  const fake=fakeTransport();
  await assert.rejects(runExecutionAgent({apiKey,input:{...input(),initialCashUsd:-1}},fake.fetcher),{code:"INVALID_EXECUTION_INPUT"});
  assert.equal(fake.sent.length,0);
  const controller=new AbortController();
  await assert.rejects(runExecutionAgent({apiKey,input:input(),signal:controller.signal},async(url,init)=>{
    const response=await fake.fetcher(url,init);
    if(!url.endsWith("/models"))controller.abort();
    return response;
  }),{code:"TIMEOUT"});
  assert.equal(fake.sent.length,1);
});

test("invalid AI reporting preserves the completed paper ledger and never retries", async () => {
  const fake=fakeTransport(undefined,{explanation:apiKey});
  const result=await runExecutionAgent({apiKey,input:input()},fake.fetcher);
  assert.ok(result.execution.orders.length>0);
  assert.equal(result.explanation,"Paper replay completed. The AI report was unavailable; the execution ledger below is authoritative.");
  assert.ok(!JSON.stringify(result).includes(apiKey));
  assert.equal(fake.sent.length,2);
});
