import { validateStrategy } from "../validation/strategy.ts";
import type { StrategyDefinition, ValidationContext } from "../validation/strategy.ts";

export type Candle = {openTimeMs: number; closeTimeMs: number; open: number; high: number; low: number; close: number};
export type PaperInput = {
  strategy: StrategyDefinition; context: ValidationContext; candles: Candle[];
  initialCashUsd: number; maxTurnoverUsd: number; feeBps: number; slippageBps: number;
};
type Signal = {actionNodeId: string; side: "BUY" | "SELL"; notional: bigint; rsi: number};
export type PaperOrder = {actionNodeId: string; side: "BUY" | "SELL"; signalTimeMs: number; fillTimeMs: number; priceUsd: string; baseQuantity: string; notionalUsd: string; feeUsd: string};
export class PaperError extends Error {
  code = "INVALID_EXECUTION_INPUT";
  status = 400;
}
const USD = 1000000n, BASE = 100000000n;
const ceil = (amount: bigint, divisor: bigint) => (amount + divisor - 1n) / divisor;
function format(amount: bigint, decimals = 6) {
  const sign = amount < 0n ? "-" : "";
  const digits = (amount < 0n ? -amount : amount).toString().padStart(decimals + 1, "0");
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
function micro(value: unknown): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1000000 || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) {
    throw new PaperError("Amounts and prices must be positive, at most 1,000,000, with at most six decimal places.");
  }
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * USD + BigInt(fraction.padEnd(6, "0"));
}

export function calculateRsi(closes: number[], period: number): number | null {
  if (!Number.isInteger(period) || period < 2 || period > 200 || !Array.isArray(closes) || closes.length > 500 || closes.some(value => !Number.isFinite(value) || value <= 0)) throw new PaperError("Invalid RSI history or period.");
  if (closes.length <= period) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {const change = closes[i]! - closes[i - 1]!; gain += Math.max(change, 0); loss += Math.max(-change, 0);}
  gain /= period; loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

export function validatePaperInput(input: PaperInput) {
  if (!input || typeof input !== "object" || Object.keys(input).some(key => !["strategy","context","candles","initialCashUsd","maxTurnoverUsd","feeBps","slippageBps"].includes(key)) ||
      !validateStrategy(input.strategy, input.context).valid || input.strategy.riskPolicy.paperTradingOnly !== true) throw new PaperError("Supply a valid paper-only strategy and trusted market context.");
  const {strategy, candles, feeBps, slippageBps} = input;
  micro(input.initialCashUsd); micro(input.maxTurnoverUsd); micro(strategy.riskPolicy.maxNotionalUsd);
  strategy.nodes.forEach(node => {if (node.type === "action.intent") micro(node.notionalUsd);});
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000 || !Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > strategy.riskPolicy.maxSlippageBps) throw new PaperError("Fees must be 0–1,000 integer bps; slippage must respect the strategy cap.");
  if (!Array.isArray(candles) || !candles.length || candles.length > 500) throw new PaperError("Supply 1–500 ordered, continuous candles.");
  let interval = 0;
  for (const [i, candle] of candles.entries()) {
    if (!candle || typeof candle !== "object" || Object.keys(candle).length !== 6 || Object.keys(candle).some(key => !["openTimeMs","closeTimeMs","open","high","low","close"].includes(key)) ||
        !Number.isSafeInteger(candle.openTimeMs) || !Number.isSafeInteger(candle.closeTimeMs) || candle.openTimeMs < 0 || candle.closeTimeMs <= candle.openTimeMs) throw new PaperError("Invalid candle times or fields.");
    for (const value of [candle.open,candle.high,candle.low,candle.close]) micro(value);
    if (candle.low > Math.min(candle.open,candle.close) || candle.high < Math.max(candle.open,candle.close)) throw new PaperError("Invalid candle OHLC range.");
    if (!i) interval = candle.closeTimeMs - candle.openTimeMs;
    else if (candle.closeTimeMs - candle.openTimeMs !== interval || candle.openTimeMs !== candles[i - 1]!.closeTimeMs) throw new PaperError("Candles must have equal intervals without gaps, duplicates or reordered timestamps.");
  }
}

export function runPaperStrategy(input: PaperInput) {
  validatePaperInput(input);
  const {strategy, candles, feeBps, slippageBps} = input;
  let cash = micro(input.initialCashUsd), base = 0n, turnover = 0n;
  const initialCash = cash, maxTurnover = micro(input.maxTurnoverUsd);
  const source = new Map(strategy.edges.map(edge => [edge.target, edge.source]));
  const nodes = new Map(strategy.nodes.map(node => [node.id, node]));
  const paths = strategy.nodes.filter(node => node.type === "action.intent").map(action => ({action, signal: nodes.get(source.get(source.get(action.id)!)!)!}));
  const closes = candles.map(candle => candle.close);
  const signals: (Signal | undefined)[] = candles.map((_candle, index) => {
    const matching: Signal[] = [];
    for (const {action, signal} of paths) {
      if (signal.type !== "indicator.rsi") throw new PaperError("Invalid execution path.");
      const rsi = calculateRsi(closes.slice(0, index + 1), signal.period);
      if (rsi !== null && (signal.comparison === "lt" ? rsi < signal.threshold : rsi > signal.threshold)) matching.push({actionNodeId: action.id, side: action.side, notional: micro(action.notionalUsd), rsi});
    }
    if (matching.length > 1) throw new PaperError("Conflicting actions match the same candle; no execution is allowed.");
    return matching[0];
  });
  const orders: PaperOrder[] = [];
  const decisions: {timeMs: number; decision: "BUY" | "SELL" | "HOLD"; reason: string; rsi?: number}[] = [];
  const rejections: {timeMs: number; actionNodeId: string; reason: string}[] = [];
  const equityCurve: {timeMs: number; valueUsd: string}[] = [];
  let pending: Signal | undefined;
  for (const [i, candle] of candles.entries()) {
    if (pending) {
      const buying = pending.side === "BUY";
      const rawPrice = micro(candle.open) * BigInt(buying ? 10000 + slippageBps : 10000 - slippageBps);
      const price = buying ? ceil(rawPrice, 10000n) : rawPrice / 10000n;
      const quantity = price > 0n ? pending.notional * BASE / price : 0n;
      const gross = buying ? ceil(quantity * price, BASE) : quantity * price / BASE;
      const fee = ceil(gross * BigInt(feeBps), 10000n);
      let reason = "";
      if (!quantity || !gross || (!buying && fee >= gross)) reason = "Order is below paper precision after costs.";
      else if (gross > micro(strategy.riskPolicy.maxNotionalUsd)) reason = "Order exceeds the strategy cap.";
      else if (turnover + gross + fee > maxTurnover) reason = "Cumulative turnover limit reached (including fees).";
      else if (buying ? cash < gross + fee : base < quantity) reason = "Insufficient virtual balance.";
      if (reason) rejections.push({timeMs: candle.openTimeMs, actionNodeId: pending.actionNodeId, reason});
      else {
        cash += buying ? -gross - fee : gross - fee;
        base += buying ? quantity : -quantity;
        turnover += gross + fee;
        orders.push({actionNodeId: pending.actionNodeId, side: pending.side, signalTimeMs: candles[i - 1]!.closeTimeMs, fillTimeMs: candle.openTimeMs, priceUsd: format(price), baseQuantity: format(quantity,8), notionalUsd: format(gross), feeUsd: format(fee)});
      }
    }
    equityCurve.push({timeMs: candle.closeTimeMs, valueUsd: format(cash + base * micro(candle.close) / BASE)});
    pending = signals[i];
    decisions.push({timeMs: candle.closeTimeMs, decision: pending?.side ?? "HOLD", reason: pending ? "Strategy condition matched; fill requires a following candle and passing risk checks." : "No matching condition or insufficient RSI history.", ...(pending ? {rsi: pending.rsi} : {})});
  }
  const finalValue = cash + base * micro(candles.at(-1)!.close) / BASE;
  return {
    mode: "PAPER" as const, orders, decisions, rejections, equityCurve,
    summary: {initialCashUsd: format(initialCash), cashUsd: format(cash), baseQuantity: format(base,8), finalValueUsd: format(finalValue), netPnlUsd: format(finalValue - initialCash), turnoverUsd: format(turnover), tradeCount: orders.length},
    ...(pending ? {unfilledSignal: {side: pending.side, actionNodeId: pending.actionNodeId, reason: "No following candle exists to fill the final signal."}} : {}),
    assumptions: ["Paper replay only; no wallet or Flash order.", "Quote currency explicitly valued at USD 1 for this replay, not a live FX claim.", "Signals at candle close; fills at next open with adverse slippage and fees.", "Virtual base precision: 8 decimals; USD precision: 6 decimals. Fees count toward cumulative turnover.", "A BUY/SELL decision is a signal; only the orders list contains filled paper trades."],
  };
}
