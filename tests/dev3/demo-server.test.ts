import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDemoServer } from "../../src/features/builder/demo/server.mjs";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

const server = createDemoServer();
let base: string;
before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

test("serves the demo and browser assets", async () => {
  for (const [path, mime] of [["/", "text/html"], ["/app.js", "text/javascript"], ["/focus.js", "text/javascript"], ["/style.css", "text/css"]]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(response.headers.get("content-type")?.includes(mime), path);
    assert.ok((await response.text()).length > 0);
  }
});

test("browser receives the real validator as executable JavaScript", async () => {
  const response = await fetch(`${base}/core/validation/strategy.ts`);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("content-type")?.includes("text/javascript"));
  const module = await import(`data:text/javascript;base64,${Buffer.from(await response.text()).toString("base64")}`);
  assert.equal(module.validateStrategy(rsiStrategy, fixtureContext).valid, true);
  assert.equal(module.validateStrategy({...rsiStrategy, edges: []}, fixtureContext).valid, false);
});

test("serves model and fixtures with no browser dependency on Node", async () => {
  for (const path of ["/core/adapters/editor.ts", "/core/fixtures/rsi-strategy.ts"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.ok(!(await response.text()).includes('from "node:'), path);
  }
});

test("unknown paths cannot read repository files", async () => {
  for (const path of ["/.git/config", "/server.mjs", "/package.json", "/%2e%2e/.git/config"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
  }
});

test("rejects mutations and disables MIME sniffing", async () => {
  const response = await fetch(`${base}/`, {method: "POST", body: "test"});
  assert.equal(response.status, 405);
  const page = await fetch(base);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
});
