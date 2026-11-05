import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { Readable } from "node:stream";
import { AgentError, readBoundedJson, runStrategyAgent, validateInferenceKey } from "../ai/zero-g.ts";
import { fixtureContext, rsiStrategy } from "../fixtures/rsi-strategy.ts";
import { PaperError, runPaperStrategy } from "../execution/paper.ts";
import { runExecutionAgent } from "../execution/agent.ts";

const assets = new Map([
  ["/", [new URL("./index.html", import.meta.url), "text/html"]],
  ["/app.js", [new URL("./app.js", import.meta.url), "text/javascript"]],
  ["/focus.js", [new URL("./focus.js", import.meta.url), "text/javascript"]],
  ["/ai.js", [new URL("./ai.js", import.meta.url), "text/javascript"]],
  ["/execution.js", [new URL("./execution.js", import.meta.url), "text/javascript"]],
  ["/replay.js", [new URL("./replay.js", import.meta.url), "text/javascript"]],
  ["/style.css", [new URL("./style.css", import.meta.url), "text/css"]],
  ["/core/validation/strategy.ts", [new URL("../validation/strategy.ts", import.meta.url), "text/javascript"]],
  ["/core/adapters/editor.ts", [new URL("../adapters/editor.ts", import.meta.url), "text/javascript"]],
  ["/core/fixtures/rsi-strategy.ts", [new URL("../fixtures/rsi-strategy.ts", import.meta.url), "text/javascript"]],
]);

export function createDemoServer({fetcher = fetch} = {}) {
  // shortcut: local demo concurrency gate, replace with authenticated per-user limits before hosting.
  let aiBusy = false;
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
        if (!body || typeof body !== "object" || Array.isArray(body) || !["AI","RULES_ONLY"].includes(body.mode) || Object.keys(body).some(key => !["mode","strategy","candles","initialCashUsd","maxTurnoverUsd","feeBps","slippageBps"].includes(key))) throw new PaperError("Use AI or RULES_ONLY paper execution with strategy, candles and limits.");
        const {mode, ...fields} = body;
        const input = {...fields,context:fixtureContext};
        if (mode === "AI") {
          apiKey = request.headers.authorization?.match(/^Bearer (sk-[A-Za-z0-9_-]+)$/)?.[1];
          validateInferenceKey(apiKey);
          data = await runExecutionAgent({apiKey,input,signal:abort.signal},fetcher);
        } else {
          data = {agentMode:"RULES_ONLY",execution:runPaperStrategy(input),explanation:"Local rules replay completed. No AI inference, wallet or Flash order was used.",reportStatus:"NOT_REQUESTED",inference:[]};
        }
      } else data = await runStrategyAgent({apiKey, input: body, defaults: rsiStrategy, context: fixtureContext, signal: abort.signal}, fetcher);
      json(200, {ok: true, data});
    } catch (error) {
      const safe = error instanceof AgentError || error instanceof PaperError ? error : new AgentError("UNAVAILABLE");
      if (!response.destroyed) json(safe.status, {ok: false, error: {code: safe.code, message: safe.message}});
    } finally {
      clearTimeout(uploadTimer);
      response.off("close", onClose);
      aiBusy = false;
      apiKey = undefined;
    }
  }
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? "")) {
      response.writeHead(403).end("Local requests only.");
      return;
    }
    let pathname;
    try { pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname; }
    catch { response.writeHead(400).end("Malformed request target."); return; }
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
  const server = createDemoServer();
  server.on("error", error => {
    console.error(`Unable to start demo: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log(`Strategy Lab: http://127.0.0.1:${port}`));
}
