import {readBoundedJson} from "../ai/zero-g.ts";
import {FlashError} from "./flash.ts";
import {networks} from "./networks.ts";
const ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const SEQUENCER = "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433";
// Base ETH/USD heartbeat is 1200s; an overdue answer blocks even paper runs.
const unavailable = (message: string) => new FlashError(message);
function words(value: unknown, count: number) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(value)) throw unavailable("Chainlink returned invalid contract data.");
  return value.slice(2).match(/.{64}/g)!.map(word => BigInt("0x" + word));
}

export async function readChainlink({fetcher = fetch, now = Date.now, rpcUrl = process.env.BASE_RPC_URL ?? networks.base.rpc, signal = AbortSignal.timeout(25000), feed = ETH_USD, maxAgeSeconds = 1200, networkId=8453, sequencer=SEQUENCER as string|null} = {}) {
  async function rpc(calls: {jsonrpc:string;id:number;method:string;params:unknown[]}[]) {
    const response = await fetcher(rpcUrl, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(calls), signal, redirect: 'error',
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw unavailable(`Price RPC request failed (HTTP ${response.status}).`);
    }
    const rows = await readBoundedJson(response, 32768, 'INVALID_OUTPUT', signal);
    if (!Array.isArray(rows) || rows.length !== calls.length ||
        rows.some(row => row?.jsonrpc !== '2.0' || row.error || !calls.some(call => call.id === row.id)) ||
        new Set(rows.map(row => row.id)).size !== calls.length) {
      throw unavailable('Price RPC returned invalid Chainlink data.');
    }
    return (id:number) => rows.find(row => row.id === id).result;
  }

  const context = await rpc([
    {jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},
    {jsonrpc:'2.0',id:5,method:'eth_getBlockByNumber',params:['latest',false]},
  ]);
  if (context(1) !== '0x' + networkId.toString(16)) throw unavailable('Chainlink RPC returned a different network.');
  const block = context(5);
  if (!block || typeof block.number !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(block.number) ||
      typeof block.timestamp !== 'string' || !/^0x[0-9a-fA-F]{1,12}$/.test(block.timestamp) ||
      BigInt(block.number) <= 0n || BigInt(block.timestamp) <= 0n) {
    throw unavailable('Price RPC returned an invalid latest block.');
  }
  const seconds = BigInt(block.timestamp);
  const clockDifference = seconds - BigInt(Math.floor(now()/1000));
  if (clockDifference > 300n || clockDifference < -300n) {
    throw unavailable('The system clock and RPC block time differ by more than five minutes.');
  }

  // Pin oracle and sequencer reads to the same block and use its time for freshness.
  const contracts = [[feed,'0x313ce567'],[feed,'0xfeaf968c'],...(sequencer?[[sequencer,'0xfeaf968c']]:[])];
  const result = await rpc(contracts.map(([to,data],index) => ({
    jsonrpc:'2.0',id:index+2,method:'eth_call',params:[{to,data},block.number],
  })));
  const [decimals] = words(result(2),1), [round,answer,,updated] = words(result(3),5);
  const [,down,started,sequencerUpdated] = sequencer ? words(result(4),5) : [1n,0n,seconds-7200n,seconds,1n];
  if (down !== 0n || !started || started > seconds || seconds - started <= 3600n ||
      !sequencerUpdated || sequencerUpdated > seconds) {
    throw unavailable('The sequencer is unavailable or within its one-hour recovery grace period.');
  }
  if (decimals! > 18n || !round || !answer || answer >= 2n**255n || !updated ||
      updated > seconds || seconds - updated > BigInt(maxAgeSeconds)) {
    throw unavailable('Chainlink USD answer is invalid or stale.');
  }
  const micros = answer * 1000000n / 10n**decimals!;
  if (micros <= 0n || micros > 1000000000000n) throw unavailable('Chainlink USD price is outside supported bounds.');
  return {priceUsd:(Number(micros)/1e6).toFixed(6),updatedAtMs:Number(updated)*1000,feed};
}
