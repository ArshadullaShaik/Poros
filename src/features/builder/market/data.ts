import {readChainlink} from "./chainlink.ts";
import {readBoundedJson} from "../ai/zero-g.ts";
import {PaperError} from "../execution/paper.ts";
import type {Candle} from "../execution/paper.ts";
import type {StrategyDefinition} from "../validation/strategy.ts";
import {validateMarketStrategy} from "./config.ts";
import {createFlashMarket, FlashError} from "./flash.ts";

const MINUTE = 60000;
const ORACLE_MAX_AGE = 1200000;
const unavailable = (message: string) => new FlashError(message);

export function createMarketData({fetcher = fetch, now = Date.now, rpcUrl = process.env.BASE_RPC_URL ?? "https://mainnet.base.org"} = {}) {
  const flash = createFlashMarket({fetcher, now});
  let candles: Candle[] = [], checkedAt = -Infinity, lastAttempt = -Infinity, healthy = false;
  let chainlink: {priceUsd: string; updatedAtMs: number; feed: string} | undefined;
  let pending: Promise<ReturnType<typeof read>> | undefined, lastError: FlashError | undefined;
  function read() {
    const quote = flash.read();
    return {source: "COINBASE_ETH_USD" as const, chain: "base", pair: "WETH/USDC", intervalMs: MINUTE,
      priceUsd: chainlink?.priceUsd ?? null, closedObservations: candles.length,
      stale: !healthy || now() < checkedAt || now() - checkedAt > MINUTE || quote.stale ||
        !chainlink || now() - chainlink.updatedAtMs > ORACLE_MAX_AGE || !candles.length || now() - candles.at(-1)!.closeTimeMs > 2 * MINUTE,
      chainlink: chainlink ? {...chainlink} : null,
      flash: {quoteId: quote.quoteId, priceUsd: quote.priceUsd, observedAtMs: quote.observedAtMs},
      maxDeviationPercent: 5};
  }
  async function history(signal: AbortSignal) {
    const end = Math.floor(now() / MINUTE) * MINUTE;
    const url = new URL("https://api.exchange.coinbase.com/products/ETH-USD/candles");
    url.search = new URLSearchParams({granularity:"60",start:new Date(end - 250 * MINUTE).toISOString(),end:new Date(end).toISOString()}).toString();
    const response = await fetcher(url, {signal, redirect: "error", cache: "no-store"});
    if (!response.ok) {void response.body?.cancel().catch(() => {}); throw unavailable(`Coinbase candle request failed (HTTP ${response.status}).`);}
    const rows = await readBoundedJson(response, 262144, "INVALID_OUTPUT", signal);
    if (!Array.isArray(rows) || !rows.length || rows.length > 300) throw unavailable("Coinbase returned invalid historical candles.");
    const result: Candle[] = [];
    const starts = new Set<number>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 6 || !row.every(value => typeof value === "number" && Number.isFinite(value)) ||
          !Number.isSafeInteger(row[0] * 1000) || row[0] <= 0 || row[0] % 60 || row[0] * 1000 > now() || starts.has(row[0]) || row[5] < 0 ||
          row.slice(1,5).some(price => price <= 0 || price > 1000000 || Math.abs(price * 1e6 - Math.round(price * 1e6)) > 0.001) ||
          row[1] > Math.min(row[3],row[4]) || row[2] < Math.max(row[3],row[4]) || row[1] > row[2]) throw unavailable("Coinbase returned invalid historical candles.");
      starts.add(row[0]);
      if (row[0] * 1000 + MINUTE <= now()) result.push({openTimeMs:row[0]*1000,closeTimeMs:row[0]*1000+MINUTE,low:row[1],high:row[2],open:row[3],close:row[4]});
    }
    result.sort((a,b) => a.openTimeMs - b.openTimeMs);
    let start = 0;
    for (let i = 1; i < result.length; i++) if (result[i]!.openTimeMs !== result[i-1]!.closeTimeMs) start = i;
    const continuous = result.slice(start);
    if (!continuous.length || now() - continuous.at(-1)!.closeTimeMs > 2 * MINUTE) throw unavailable("Coinbase historical candles are missing or stale.");
    return continuous;
  }
  async function collect() {
    healthy = false;
    try {
      const signal = AbortSignal.timeout(25000);
      const results = await Promise.allSettled([history(signal),readChainlink({fetcher,now,rpcUrl,signal}),flash.refresh()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
      const historyResult = (results[0] as PromiseFulfilledResult<Candle[]>).value;
      const reference = (results[1] as PromiseFulfilledResult<NonNullable<typeof chainlink>>).value;
      const referencePrice = Number(reference.priceUsd), quote = flash.read();
      if (quote.stale || !quote.priceUsd || [historyResult.at(-1)!.close,Number(quote.priceUsd)].some(price=>Math.abs(price/referencePrice-1)>0.05)) throw unavailable("Price sanity check failed: Coinbase or Flash differs from Chainlink by more than 5%.");
      candles = historyResult; chainlink = reference; checkedAt = now(); healthy = true; lastError = undefined;
      return read();
    } catch (error) {
      lastError = error instanceof FlashError ? error : unavailable("Market data could not be fetched or validated. Check Coinbase, Base RPC and Flash availability.");
      throw lastError;
    }
  }
  function refresh() {
    if (pending) return pending;
    if (now() - lastAttempt < MINUTE) return lastError ? Promise.reject(lastError) : Promise.resolve(read());
    lastAttempt = now(); pending = collect().finally(()=>{pending=undefined;}); return pending;
  }
  function candlesFor(strategy: StrategyDefinition) {
    if (!validateMarketStrategy(strategy).valid) throw new PaperError("Use a valid paper strategy for Base WETH/USDC.");
    if (read().stale) throw new PaperError("Market data is missing, stale or failed its Chainlink sanity check. Refresh market data before running.");
    const needed = Math.max(2,...strategy.nodes.filter(node=>node.type==="indicator.rsi").map(node=>node.period)) + 2;
    if (candles.length < needed) throw new PaperError(`Need ${needed} continuous historical one-minute candles (${candles.length} available).`);
    return structuredClone(candles);
  }
  return {refresh,read,candlesFor};
}
