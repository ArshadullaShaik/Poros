import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { Readable } from "node:stream";
import { AgentError, readBoundedJson, runStrategyAgent, validateInferenceKey } from "../ai/zero-g.ts";
import { marketContext, marketStrategy, pairForStrategy } from "../market/config.ts";
import { FlashError } from "../market/flash.ts";
import { createLiveMarkets } from "../market/live.ts";
import { createPriceMonitor, invokePriceExecution } from "../execution/monitor.ts";
import { interpretCreatorStrategy } from "../ai/interpreter.ts";
import { PaperError, runPaperStrategy } from "../execution/paper.ts";
import { runExecutionAgent } from "../execution/agent.ts";
import { createSepoliaProxy, createArkivProxy } from "./sepolia-rpc.mjs";

const assets = new Map([
  ...["/community","/community/"].map(path=>[path,[new URL("../../../../apps/web/dist/index.html",import.meta.url),"text/html"]]),
  ...[["app.js","text/javascript"],["builder.js","text/javascript"],["preview.js","text/javascript"],["app.css","text/css"],["favicon.svg","image/svg+xml"]].map(([name,mime])=>[`/community/${name}`,[new URL(`../../../../apps/web/dist/${name}`,import.meta.url),mime]]),
  ["/", [new URL("./index.html", import.meta.url), "text/html"]],
  ["/app.js", [new URL("./app.js", import.meta.url), "text/javascript"]],
  ["/solana-wallet.js", [new URL("./solana-wallet.js", import.meta.url), "text/javascript"]],
  ["/wallet.js", [new URL("./wallet.js", import.meta.url), "text/javascript"]],
  ["/focus.js", [new URL("./focus.js", import.meta.url), "text/javascript"]],
  ["/ai.js", [new URL("./ai.js", import.meta.url), "text/javascript"]],
  ["/community-library.js", [new URL("./community.js", import.meta.url), "text/javascript"]],
  ["/chart.js", [new URL("./chart.js", import.meta.url), "text/javascript"]],
  ["/prices.js", [new URL("./prices.js", import.meta.url), "text/javascript"]],
  ["/execution.js", [new URL("./execution.js", import.meta.url), "text/javascript"]],
  ["/replay.js", [new URL("./replay.js", import.meta.url), "text/javascript"]],
  ["/style.css", [new URL("./style.css", import.meta.url), "text/css"]],
  ["/core/validation/strategy.ts", [new URL("../validation/strategy.ts", import.meta.url), "text/javascript"]],
  ["/core/adapters/editor.ts", [new URL("../adapters/editor.ts", import.meta.url), "text/javascript"]],
  ["/core/fixtures/rsi-strategy.ts", [new URL("../fixtures/rsi-strategy.ts", import.meta.url), "text/javascript"]],
  ["/core/market/networks.ts", [new URL("../market/networks.ts", import.meta.url), "text/javascript"]],
  ["/core/market/config.ts", [new URL("../market/config.ts", import.meta.url), "text/javascript"]],
]);

export function createDemoServer({fetcher = fetch, market = createLiveMarkets({fetcher})} = {}) {
  // shortcut: local demo concurrency gate, replace with authenticated per-user limits before hosting.
  const handleSepolia = createSepoliaProxy(fetcher);
  const handleArkiv = createArkivProxy(fetcher);
  let aiBusy = false;
  const monitor = createPriceMonitor({market,fetcher,invoke:async(options)=>{
    if(aiBusy)throw new AgentError("RATE_LIMITED");
    aiBusy=true;try{return await invokePriceExecution(options,fetcher);}finally{aiBusy=false;}
  }});
  async function handleAi(request, response, execution = false) {
    const json = (status, payload) => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.writeHead(status).end(JSON.stringify(payload));
    };
    if ((request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) ||
        (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(request.headers["sec-fetch-site"]))) {
      json(403, {ok: false, error: {code: "FORBIDDEN", message: "Open AI from this local demo only."}}); return;
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers["content-type"] ?? "")) {
      json(415, {ok: false, error: {code: "INVALID_INPUT", message: "Send application/json."}}); return;
    }
    let apiKey;
    if (!execution) {
      try {apiKey = request.headers.authorization?.match(/^Bearer (sk-[A-Za-z0-9_-]+)$/)?.[1]; validateInferenceKey(apiKey);}
      catch (error) {json(401, {ok:false,error:{code:"UNAUTHORIZED",message:error.message}});return;}
    }
    if (Number(request.headers["content-length"]) > 65536) {
      json(413, {ok: false, error: {code: "INVALID_INPUT", message: "AI requests must be at most 64 KiB."}}); return;
    }
    if (aiBusy) { const error = new AgentError("RATE_LIMITED"); json(error.status, {ok: false, error: {code: error.code, message: error.message}}); return; }
    aiBusy = true;
    const abort = new AbortController();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.once("close", onClose);
    const uploadTimer = setTimeout(() => abort.abort(), 10000);
    try {
      const body = await readBoundedJson(new Response(Readable.toWeb(request)), 65536, "INVALID_INPUT", abort.signal);
      clearTimeout(uploadTimer);
      let data;
      if (execution) {
        if (!body || typeof body !== "object" || Array.isArray(body) || !["AI","RULES_ONLY"].includes(body.mode) || Object.keys(body).some(key => !["mode","strategy","initialCashUsd","maxTurnoverUsd","feeBps","slippageBps"].includes(key))) throw new PaperError("Use AI or RULES_ONLY paper execution with a strategy and limits. Historical candles are supplied by the server.");
        const {mode, ...fields} = body;
        if (mode === "AI") {
          apiKey = request.headers.authorization?.match(/^Bearer (sk-[A-Za-z0-9_-]+)$/)?.[1];
          validateInferenceKey(apiKey);
        }
        if (!market.candlesFor) throw new PaperError("Historical replay is disabled. Use the live price monitor.");
        await market.refresh();
        const input = {...fields,context:marketContext,candles:market.candlesFor(fields.strategy)};
        const marketData = market.read();
        if (mode === "AI") {
          data = await runExecutionAgent({apiKey,input,signal:abort.signal,marketData:{source:marketData.source,chain:marketData.chain,pair:marketData.pair,referenceSource:"CHAINLINK_ETH_USD",quoteSource:"DEFINITIVE_FLASH"}},fetcher);
        } else {
          data = {agentMode:"RULES_ONLY",execution:runPaperStrategy(input),explanation:"Paper replay completed using Coinbase ETH/USD historical candles as a WETH proxy, checked against Chainlink and a live Flash quote. No AI inference, wallet or Flash order was used.",reportStatus:"NOT_REQUESTED",inference:[]};
        }
        data.marketData = {...marketData,firstOpenTimeMs:input.candles[0].openTimeMs,lastCloseTimeMs:input.candles.at(-1).closeTimeMs};
        data.execution.assumptions.unshift("Coinbase ETH/USD minute candles are a proxy for Base WETH/USDC, not historical Flash fills. Chainlink and Flash check current prices only. Fills, fees and balances are simulated.");
      } else data = await runStrategyAgent({apiKey, input: body, defaults: marketStrategy, context: marketContext, signal: abort.signal}, fetcher);
      json(200, {ok: true, data});
    } catch (error) {
      const safe = error instanceof AgentError || error instanceof PaperError || error instanceof FlashError ? error : new AgentError("UNAVAILABLE");
      if (!response.destroyed) json(safe.status, {ok: false, error: {code: safe.code, message: safe.message}});
    } finally {
      clearTimeout(uploadTimer);
      response.off("close", onClose);
      aiBusy = false;
      apiKey = undefined;
    }
  }
  async function handleMonitor(request,response,interpret=false) {
    const json=(status,payload)=>{response.setHeader("Content-Type","application/json; charset=utf-8");response.writeHead(status).end(JSON.stringify(payload));};
    if((request.headers.origin&&request.headers.origin!==`http://${request.headers.host}`)||(request.headers["sec-fetch-site"]&&!["same-origin","none"].includes(request.headers["sec-fetch-site"]))) {json(403,{ok:false,error:{message:"Open this from the local demo only."}});return;}
    if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers["content-type"]??"")){json(415,{ok:false,error:{message:"Send application/json."}});return;}
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),45000);
    const close=()=>{if(!response.writableEnded)abort.abort();};response.once("close",close);
    try {
      const body=await readBoundedJson(new Response(Readable.toWeb(request)),65536,"INVALID_INPUT",abort.signal);
      if(!body||typeof body!=="object"||Array.isArray(body))throw new PaperError("Invalid monitor request.");
      const key=request.headers.authorization?.match(/^Bearer (sk-[A-Za-z0-9_-]+)$/)?.[1];
      let data;
      if(interpret){
        if(Object.keys(body).some(key=>!["text","name"].includes(key)))throw new PaperError("Send creator text and name only.");
        validateInferenceKey(key);
        if(aiBusy)throw new AgentError("RATE_LIMITED");
        aiBusy=true;
        try{data=await interpretCreatorStrategy({apiKey:key,...body,signal:abort.signal},fetcher);}finally{aiBusy=false;}
      }else if(body.action==="start"){
        if(Object.keys(body).some(key=>!["action","mode","strategy","initialCashUsd","maxTurnoverUsd","feeBps","slippageBps","wallet"].includes(key)))throw new PaperError("Unsupported monitor field.");
        if(body.mode==="AI"||body.mode==="LIVE")validateInferenceKey(key);
        data=monitor.start(body);
      }else{
        if(!["check","stop","submit","setup"].includes(body.action)||Object.keys(body).some(key=>!(body.action==="submit"?["action","id","signature"]:body.action==="setup"?["action","id","signedSetupTx"]:["action","id"]).includes(key))||typeof body.id!=="string")throw new PaperError("Send a monitor action and ID.");
        data=body.action==="setup"?await monitor.setup(body.id,body.signedSetupTx,abort.signal):body.action==="submit"?await monitor.submit(body.id,body.signature,abort.signal):body.action==="stop"?monitor.stop(body.id):await monitor.check(body.id,key,abort.signal);
      }
      json(200,{ok:true,data});
    }catch(error){const safe=error instanceof AgentError||error instanceof PaperError||error instanceof FlashError?error:new AgentError("UNAVAILABLE");if(!response.destroyed)json(safe.status,{ok:false,error:{code:safe.code,message:safe.message}});}
    finally{clearTimeout(timer);response.off("close",close);}
  }
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https://rpc.rabdi.db-chain.testnet.arkiv.network; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) {
      response.writeHead(403).end("Local requests only.");
      return;
    }
    let pathname;
    try { pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; }
    catch { response.writeHead(400).end("Malformed request target."); return; }
    if (pathname === "/api/arkiv-rpc") {await handleArkiv(request,response);return;}
    if (pathname === "/api/sepolia-rpc") {await handleSepolia(request,response);return;}
    if (pathname === "/api/market" || pathname === "/api/price" || pathname === "/api/chart-price") {
      if (request.method !== "GET") {response.setHeader("Allow","GET");response.writeHead(405).end("Method not allowed.");return;}
      if ((request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) ||
          (request.headers["sec-fetch-site"] && !["same-origin","none"].includes(request.headers["sec-fetch-site"]))) {response.writeHead(403).end("Open market data from this local demo only.");return;}
      response.setHeader("Content-Type","application/json; charset=utf-8");
      try {const pairId=new URL(request.url,"http://127.0.0.1").searchParams.get("pair")??"eth-usdc";pairForStrategy(pairId);const data=await (pathname==="/api/chart-price"?market.chartPrice(pairId):pathname==="/api/price"?market.displayPrice(pairId):market.refresh(pairId));response.writeHead(200).end(JSON.stringify({ok:true,data}));}
      catch (error) {if(error?.message==="Choose a supported trading pair and network."){response.writeHead(400).end(JSON.stringify({ok:false,error:{message:error.message}}));return;}const safe=error instanceof FlashError?error:new FlashError("Historical, Chainlink or Flash market data is unavailable.");response.writeHead(safe.status).end(JSON.stringify({ok:false,error:{code:safe.code,message:safe.message}}));}
      return;
    }
    if (pathname === "/api/monitor" || pathname === "/api/interpret") {
      if(request.method!=="POST"){response.setHeader("Allow","POST");response.writeHead(405).end("Method not allowed.");return;}
      await handleMonitor(request,response,pathname==="/api/interpret");return;
    }
    if (pathname === "/api/ai" || pathname === "/api/execution") {
      if (request.method === "POST") { await handleAi(request, response, pathname === "/api/execution"); return; }
      response.setHeader("Allow", "POST");
      response.writeHead(405).end("Method not allowed."); return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.writeHead(405).end("Method not allowed.");
      return;
    }
    const asset = assets.get(pathname);
    if (!asset) {
      response.writeHead(404).end("Not found.");
      return;
    }
    try {
      const [path, mime] = asset;
      let content = await readFile(path, "utf8");
      if (path.pathname.endsWith(".ts")) content = stripTypeScriptTypes(content);
      response.setHeader("Content-Type", `${mime}; charset=utf-8`);
      response.writeHead(200).end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      console.error("Demo asset error:", error.message);
      response.writeHead(500).end("Unable to load the demo asset. Check the local terminal.");
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.DEV3_DEMO_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DEV3_DEMO_PORT must be from 1 to 65535.");
  const market = createLiveMarkets();
  const server = createDemoServer({market});
  server.once("listening", () => {
    const collect = () => {void market.refresh().catch(() => {});};
    collect();
    const polling = setInterval(collect, 10000);
    polling.unref();
    server.once("close", () => clearInterval(polling));
  });
  server.on("error", error => {
    console.error(`Unable to start demo: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log(`Poros: http://127.0.0.1:${port}`));
}
