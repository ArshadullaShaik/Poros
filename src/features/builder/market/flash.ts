import {readBoundedJson} from "../ai/zero-g.ts";
import {PaperError} from "../execution/paper.ts";
import type {Candle} from "../execution/paper.ts";
import type {StrategyDefinition} from "../validation/strategy.ts";
import {marketContext, validateMarketStrategy, pairForStrategy} from "./config.ts";

const INTERVAL = 60000, REFRESH = 2000;
// Public development integrator key from Definitive's getting-started guide.
const DEVELOPMENT_KEY = "dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b";
export class FlashError extends Error {code = "FLASH_UNAVAILABLE"; status = 503;}
function decimal(value: unknown) {
  if (typeof value !== "string" || !/^\d{1,18}(?:\.\d{1,36})?$/.test(value)) throw new FlashError("Flash returned an invalid quote amount.");
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole + fraction);
  if (!raw) throw new FlashError("Flash returned a zero quote amount.");
  return {raw, scale: 10n ** BigInt(fraction.length)};
}

export function createFlashMarket({fetcher = fetch, now = Date.now, apiKey = process.env.FLASH_API_KEY ?? DEVELOPMENT_KEY, pair = pairForStrategy()} = {}) {
  let latest: {quoteId: string; observedAtMs: number; priceUsd: string} | undefined;
  let lastAttempt = -Infinity, lastError: FlashError | undefined, pending: Promise<ReturnType<typeof read>> | undefined;
  let candles: Candle[] = [];
  const completed = () => candles.filter(candle => candle.closeTimeMs <= now()).slice(-500);
  function read() {
    return {source: "DEFINITIVE_FLASH" as const, chain: "base", pair: `${pair.base.symbol}/${pair.quote.symbol}`, intervalMs: INTERVAL,
      priceUsd: latest?.priceUsd ?? null, observedAtMs: latest?.observedAtMs ?? null, quoteId: latest?.quoteId ?? null,
      closedObservations: completed().length, stale: !latest || now() - latest.observedAtMs > INTERVAL};
  }
  async function collect() {
    try {
      const signal = AbortSignal.timeout(25000);
      const response = await fetcher("https://flash.definitive.fi/v1/quote", {method: "POST", signal, redirect: "error",
        headers: {"Content-Type": "application/json", "x-definitive-api-key": apiKey},
        body: JSON.stringify({targetChain: pair.network.key, contraChain: pair.network.key, targetAsset: pair.base.native&&pair.network.family!=="solana"?pair.base.wrappedAddress:pair.base.address, contraAsset: pair.quote.address, side: "buy", qty: "20", orderType: "market", maxSlippage: "0.005"})});
      if (!response.ok) {void response.body?.cancel().catch(() => {}); throw new FlashError(`Flash quote request failed (HTTP ${response.status}).`);}
      const quote = await readBoundedJson(response, 262144, "INVALID_OUTPUT", signal);
      if (typeof quote?.quoteId !== "string" || !quote.quoteId.trim() || quote.quoteId.length > 128 || quote.quoteId.includes(apiKey) ||
          quote.side !== "buy" || quote.orderType !== "market" || quote.targetAsset?.toLowerCase() !== (pair.base.native&&pair.network.family!=="solana"?pair.base.wrappedAddress!:pair.base.address).toLowerCase() ||
          quote.contraAsset?.toLowerCase() !== pair.quote.address.toLowerCase() || quote.from?.asset !== "contra" || quote.to?.asset !== "target") throw new FlashError("Flash returned a quote for an unexpected market.");
      const spent = decimal(quote.from.amount), amount = decimal(quote.to.amount), notional = decimal(quote.to.notional);
      if (spent.raw !== 20n * spent.scale) throw new FlashError("Flash returned an unexpected reference amount.");
      const micros = notional.raw * amount.scale * 1000000n / (notional.scale * amount.raw);
      if (micros <= 0n || micros > 1000000000000n) throw new FlashError("Flash returned a reference price outside supported bounds.");
      const price = Number(micros) / 1000000, observedAtMs = now();
      const start = Math.floor(observedAtMs / INTERVAL) * INTERVAL, previous = candles.at(-1);
      if (previous && (start > previous.closeTimeMs || start < previous.openTimeMs)) candles = [];
      const current = candles.at(-1);
      if (current?.openTimeMs === start) {current.high = Math.max(current.high, price); current.low = Math.min(current.low, price); current.close = price;}
      else candles.push({openTimeMs: start, closeTimeMs: start + INTERVAL, open: price, high: price, low: price, close: price});
      if (candles.length > 501) candles.shift();
      latest = {quoteId: quote.quoteId, observedAtMs, priceUsd: price.toFixed(6)};
      lastError = undefined;
      return read();
    } catch (error) {
      lastError = error instanceof FlashError ? error : new FlashError("Flash quote data could not be fetched or validated.");
      throw lastError;
    }
  }
  function refresh() {
    if (pending) return pending;
    if (now() - lastAttempt < REFRESH) return lastError ? Promise.reject(lastError) : Promise.resolve(read());
    lastAttempt = now();
    pending = collect().finally(() => {pending = undefined;});
    return pending;
  }
  function candlesFor(strategy: StrategyDefinition) {
    if (!validateMarketStrategy(strategy).valid) throw new PaperError("Use a valid paper strategy for Base WETH/USDC.");
    if (read().stale) throw new PaperError("Flash observations are missing or stale. Wait for a fresh quote.");
    const needed = Math.max(...strategy.nodes.filter(node => node.type === "indicator.rsi").map(node => node.period)) + 2;
    const history = completed();
    if (history.length < needed) throw new PaperError(`Collect ${needed} completed one-minute Flash observations before running this RSI strategy (${history.length} available).`);
    return structuredClone(history);
  }
  return {refresh, read, candlesFor};
}
