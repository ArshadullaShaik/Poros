import {readBoundedJson} from "../ai/zero-g.ts";
import {FlashError} from "./flash.ts";
const ETH_USD = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const SEQUENCER = "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433";
// Base ETH/USD heartbeat is 1200s; an overdue answer blocks even paper runs.
const unavailable = (message: string) => new FlashError(message);
function words(value: unknown, count: number) {
  if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${count * 64}}$`).test(value)) throw unavailable("Chainlink returned invalid contract data.");
  return value.slice(2).match(/.{64}/g)!.map(word => BigInt("0x" + word));
}

export async function readChainlink({fetcher = fetch, now = Date.now, rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org", signal = AbortSignal.timeout(25000)} = {}) {
    const calls = [
      {jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]},
      ...[[ETH_USD,"0x313ce567"],[ETH_USD,"0xfeaf968c"],[SEQUENCER,"0xfeaf968c"]].map(([to,data],i)=>({jsonrpc:"2.0",id:i+2,method:"eth_call",params:[{to,data},"latest"]})),
    ];
    const response = await fetcher(rpcUrl, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(calls),signal,redirect:"error"});
    if (!response.ok) {void response.body?.cancel().catch(() => {}); throw unavailable(`Base RPC request failed (HTTP ${response.status}).`);}
    const rows = await readBoundedJson(response, 32768, "INVALID_OUTPUT", signal);
    if (!Array.isArray(rows) || rows.length !== 4 || rows.some(row => row?.jsonrpc !== "2.0" || row.error || ![1,2,3,4].includes(row.id)) || new Set(rows.map(row=>row.id)).size !== 4) throw unavailable("Base RPC returned invalid Chainlink data.");
    const result = (id: number) => rows.find(row=>row.id===id).result;
    if (result(1) !== "0x2105") throw unavailable("Chainlink requires the Base mainnet RPC.");
    const [decimals] = words(result(2),1), [round,answer,,updated] = words(result(3),5);
    const [,down,started,sequencerUpdated] = words(result(4),5), seconds = BigInt(Math.floor(now()/1000));
    if (down !== 0n || !started || started! > seconds || seconds - started! <= 3600n || !sequencerUpdated || sequencerUpdated > seconds) throw unavailable("Base sequencer is unavailable or within its one-hour recovery grace period.");
    if (decimals! > 18n || !round || !answer || answer! >= 2n**255n || !updated || updated! > seconds || seconds - updated! > 1200n) throw unavailable("Chainlink ETH/USD answer is invalid or stale.");
    const micros = answer! * 1000000n / 10n**decimals!;
    if (micros <= 0n || micros > 1000000000000n) throw unavailable("Chainlink ETH/USD price is outside supported bounds.");
    return {priceUsd:(Number(micros)/1e6).toFixed(6),updatedAtMs:Number(updated)*1000,feed:ETH_USD};
  }
