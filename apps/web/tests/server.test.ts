import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {readFile, readdir} from 'node:fs/promises';
import next from 'next';

test('Next serves every workspace with one identity and isolated browser assets', async () => {
  const app = next({dev: false, dir: fileURLToPath(new URL('../', import.meta.url))});
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    let logo: string | undefined;
    for (const path of ['/', '/orders', '/home', '/community', '/profile', '/0g-pot', '/community?preview=1']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const html = await response.text();
      const policy = response.headers.get('content-security-policy');
      assert.match(policy ?? '', /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      assert.match(html, /<script[^>]+nonce="[^"]+"/);
      assert.ok(policy?.includes("form-action 'self'"));
      const header = html.match(/<header class="poros-header">.*?<\/header>/s)?.[0];
      assert.ok(header, path);
      const mark = header.match(/<svg.*?<\/svg>/s)?.[0];
      assert.ok(mark);
      logo ??= mark;
      assert.equal(mark, logo);
      for (const label of ['Home', 'Trade', 'Orders', 'Communities', 'Profile', '0G Pot']) assert.ok(header.includes(label));
      assert.equal((html.match(/id="wallet-connect"/g) ?? []).length, 1);
      assert.match(html, /\/_next\/static\//);
      if (path === '/') {
        assert.match(html, /id="canvas"/);
        assert.doesNotMatch(html, /id="market-chart-svg"/);
        assert.match(html, /draggable="true"/);
        assert.match(html, /id="publish-community"/);
      }
      if(path === '/orders'){assert.match(html,/id="market-chart-svg"/);assert.match(html,/Transaction history/);assert.doesNotMatch(html,/id="canvas"/);}
    }
    for (const path of ['/.env', '/.env.local', '/vault.sqlite', '/src/main.ts', '/core/validation/strategy.ts', '/package.json', '/.git/config', '/server.mjs', '/community/app.js']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
    assert.equal((await fetch(base + '/api/community-marketplace/orders')).status, 404);
    assert.equal((await fetch(base + '/api/monitor')).status, 405);
    assert.equal((await fetch(base + '/api/performance?wallet=invalid')).status, 400);
    assert.equal((await fetch(base + '/api/sepolia-rpc', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://foreign.example'}, body: '{}'})).status, 403);
    assert.equal((await fetch(base + '/api/sepolia-rpc', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendTransaction',params:[]})})).status, 400);
    const assets = new URL('../.next/static/', import.meta.url);
    for (const name of await readdir(assets, {recursive: true})) {
      if (!name.endsWith('.js')) continue;
      const script = await readFile(new URL(name.replaceAll('\\', '/'), assets), 'utf8');
      assert.doesNotMatch(script, /node:sqlite|createWalletAuth|openMarketplace|ARKIV_ACCESS_KEY|MEMBERSHIP_RELAY_PRIVATE_KEY|diagnostic-private/);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await app.close();
  }
});
