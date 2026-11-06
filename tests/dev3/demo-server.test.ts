import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createDemoServer } from "../../src/features/builder/demo/server.mjs";

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

test("unknown paths cannot read repository files", async () => {
  for (const path of ["/.git/config", "/server.mjs", "/package.json", "/%2e%2e/.git/config"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
  }
});

test("rejects mutations and disables MIME sniffing", async () => {
  const response = await fetch(`${base}/api/market`, {method: "POST", body: "test"});
  assert.equal(response.status, 405);
  const page = await fetch(base);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
});
