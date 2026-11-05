import { Readable } from 'node:stream';
import { readBoundedJson } from '../ai/zero-g.ts';

export function createSepoliaProxy(fetcher = fetch) {
  let active = 0;
  return async (request, response) => {
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    if ((request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) ||
        (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) {
      json(403, { error: 'FORBIDDEN' }); return;
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) { json(415, { error: 'INVALID_INPUT' }); return; }
    if (active >= 4) { json(429, { error: 'RATE_LIMITED' }); return; }
    active++;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const body = await readBoundedJson(new Response(Readable.toWeb(request)), 4096, 'INVALID_INPUT', abort.signal);
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' ||
          !['string','number'].includes(typeof body.id) || !Array.isArray(body.params)) throw new Error('Invalid RPC');
      const hashMethod = ['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(body.method);
      const headMethod = ['eth_chainId','eth_blockNumber'].includes(body.method);
      const blockMethod = body.method === 'eth_getBlockByNumber';
      const valid = hashMethod ? body.params.length === 1 && /^0x[0-9a-f]{64}$/i.test(body.params[0]) :
        headMethod ? body.params.length === 0 : blockMethod && body.params.length === 2 &&
        /^(0x[0-9a-f]+|latest)$/i.test(body.params[0]) && body.params[1] === false;
      if (!valid) { json(400, { error: 'UNSUPPORTED_RPC' }); return; }
      const url = new URL(process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com');
      if (url.protocol !== 'https:') throw new Error('HTTPS required');
      const upstream = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, method: body.method, params: body.params }), signal: abort.signal });
      if (!upstream.ok) throw new Error('RPC unavailable');
      const result = await readBoundedJson(upstream, 1048576, 'UNAVAILABLE', abort.signal);
      if (result?.error || result?.jsonrpc !== '2.0' || result?.id !== body.id || !Object.hasOwn(result, 'result')) throw new Error('RPC unavailable');
      json(200, result);
    } catch { json(503, { error: 'SEPOLIA_UNAVAILABLE' }); }
    finally { clearTimeout(timeout); active--; }
  };
}
