import {applicationOrigin} from './deployment.mjs';
import { rabdi } from '../../../integrations/arkiv/index.ts';
import { Readable } from 'node:stream';
import { readBoundedJson } from '../ai/zero-g.ts';
import { createArkivReads } from './arkiv-reads.mjs';

export function createSepoliaProxy(fetcher = fetch) { return createReadProxy(fetcher,'sepolia'); }
export function createArkivProxy(fetcher = fetch) { return createReadProxy(fetcher,'arkiv'); }

function createReadProxy(fetcher, network) {
  let active = 0;
  const sharedRead = network === 'arkiv' ? createArkivReads() : null;
  return async (request, response) => {
    const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control':'no-store' }).end(JSON.stringify(body)); };
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(405, { error: 'METHOD_NOT_ALLOWED' }); return; }
    if ((request.headers.origin && request.headers.origin !== applicationOrigin(request)) ||
        (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) {
      json(403, { error: 'FORBIDDEN' }); return;
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? '')) { json(415, { error: 'INVALID_INPUT' }); return; }
    if (active >= (network === 'arkiv' ? 128 : 4)) { response.setHeader('Retry-After','1'); json(429, { error: 'RATE_LIMITED' }); return; }
    active++;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const body = await readBoundedJson(new Response(Readable.toWeb(request)), network === 'arkiv' ? 16384 : 4096, 'INVALID_INPUT', abort.signal);
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0' ||
          !['string','number'].includes(typeof body.id) || (body.params !== undefined && !Array.isArray(body.params))) throw new Error('Invalid RPC');
      body.params ??= [];
      const hashMethod = ['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(body.method);
      const headMethod = ['eth_chainId','eth_blockNumber'].includes(body.method);
      const blockMethod = body.method === 'eth_getBlockByNumber';
      const arkivMethod = network === 'arkiv' && (body.method === 'arkiv_getBlockTiming' && body.params.length === 0 || body.method === 'arkiv_getEntity' && /^0x[0-9a-f]{64}$/i.test(body.params[0]) || body.method === 'arkiv_query' && typeof body.params[0] === 'string');
      const valid = arkivMethod || (hashMethod ? body.params.length === 1 && /^0x[0-9a-f]{64}$/i.test(body.params[0]) :
        headMethod ? body.params.length === 0 : blockMethod && body.params.length === 2 &&
        /^(0x[0-9a-f]+|latest)$/i.test(body.params[0]) && body.params[1] === false);
      if (!valid) { json(400, { error: 'UNSUPPORTED_RPC' }); return; }
      const url = new URL(network === 'arkiv' ? rabdi({accessKey:process.env.ARKIV_ACCESS_KEY ?? ''}).rpcUrls.default.http[0] : process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com');
      if (url.protocol !== 'https:') throw new Error('HTTPS required');
      const load = async () => {
        const upstream = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: body.id, method: body.method, params: body.params }), signal: abort.signal });
        if (upstream.status === 429) {
          const header=upstream.headers.get('retry-after');
          const delay=header ? (/^\d+$/.test(header) ? Number(header) : (Date.parse(header)-Date.now())/1000) : 10;
          void upstream.body?.cancel().catch(()=>{});
          return {status:429,retryAfter:Number.isFinite(delay)?delay:10,payload:{jsonrpc:'2.0',error:{code:429,message:'RPC query budget exhausted. Please retry after the cooldown.'}}};
        }
        if (!upstream.ok) throw new Error('RPC unavailable');
        const result = await readBoundedJson(upstream, 1048576, 'UNAVAILABLE', abort.signal);
        if (network === 'arkiv' && result?.error) {
          if (result.error === 'ANON_COST_LIMITED' || result.error.code === 429 || /budget exhausted|rate limit|ANON_COST_LIMITED/i.test(String(result.message)+' '+String(result.error.message))) {
            return {status:429,retryAfter:30,payload:{jsonrpc:'2.0',error:{code:429,message:'Arkiv query budget exhausted. Configure ARKIV_ACCESS_KEY on the server and retry after the cooldown.'}}};
          }
          const code = typeof result.error === 'object' ? result.error.code : -32000;
          const msg = (typeof result.error === 'object' ? result.error.message : result.message) || String(result.error) || 'Arkiv read failed';
          return {status:200,payload:{jsonrpc:'2.0',error:{code,message:msg}}};
        }
        if (result?.error || result?.jsonrpc !== '2.0' || result?.id !== body.id || !Object.hasOwn(result, 'result')) throw new Error('RPC unavailable');
        return {status:200,payload:result};
      };
      const result = sharedRead ? await sharedRead(body,load,abort.signal) : await load();
      if (result.retryAfter) response.setHeader('Retry-After',String(result.retryAfter));
      json(result.status,{...result.payload,id:body.id});
    } catch { json(503, { error: network === 'arkiv' ? 'ARKIV_UNAVAILABLE' : 'SEPOLIA_UNAVAILABLE' }); }
    finally { clearTimeout(timeout); active--; }
  };
}
