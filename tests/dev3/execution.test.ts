import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateRsi, runPaperStrategy } from "../../src/features/builder/execution/paper.ts";
import { fixtureContext, rsiStrategy } from "../../src/features/builder/fixtures/rsi-strategy.ts";

const candles = (closes: number[]) => closes.map((close, i) => ({openTimeMs: i * 60000, closeTimeMs: (i + 1) * 60000, open: i ? closes[i - 1]! : close, close, high: Math.max(close, i ? closes[i - 1]! : close) + 1, low: Math.min(close, i ? closes[i - 1]! : close) - 1}));
function input(closes = [100, 90, 80, 70, 80, 90, 100]) {
  const strategy = structuredClone(rsiStrategy);
  strategy.nodes.forEach(node => {if (node.type === "indicator.rsi") node.period = 2;});
  return {strategy, context: fixtureContext, candles: candles(closes), initialCashUsd: 100, maxTurnoverUsd: 1000, feeBps: 0, slippageBps: 0};
}

test("Wilder RSI matches reference values and handles warm-up, gains, losses and flat prices", () => {
  assert.equal(calculateRsi([1, 2], 2), null);
  assert.equal(calculateRsi([1, 2, 3], 2), 100);
  assert.equal(calculateRsi([3, 2, 1], 2), 0);
  assert.equal(calculateRsi([3, 3, 3], 2), 50);
  assert.ok(Math.abs(calculateRsi([44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28],14)! - 70.464135) < 0.000001);
});

test("runs actual validated RSI paths and fills signals at the next open", () => {
  const data = input(), before = structuredClone(data);
  const result = runPaperStrategy(data);
  assert.equal(result.mode, "PAPER");
  assert.equal(result.orders[0]!.side, "BUY");
  assert.equal(result.orders[0]!.signalTimeMs, 180000);
  assert.equal(result.orders[0]!.fillTimeMs, 180000);
  assert.equal(result.orders[0]!.priceUsd, "80.000000");
  assert.equal(result.orders[0]!.baseQuantity, "0.25000000");
  assert.equal(result.orders[0]!.notionalUsd, "20.000000");
  assert.ok(result.orders.some(order => order.side === "SELL"));
  assert.equal(result.decisions[0]!.decision, "HOLD");
  assert.deepEqual(data, before);
  assert.deepEqual(runPaperStrategy(data), result);
});

test("fees/slippage are adverse, precision is conservative and balances cannot be negative", () => {
  const data = {...input(), feeBps: 10, slippageBps: 50};
  const result = runPaperStrategy(data);
  assert.equal(result.orders[0]!.priceUsd, "80.400000");
  assert.equal(result.orders[0]!.baseQuantity, "0.24875621");
  assert.equal(result.orders[0]!.feeUsd, "0.020000");
  assert.ok(!result.summary.cashUsd.startsWith("-"));
  assert.ok(!result.summary.baseQuantity.startsWith("-"));
  assert.ok(result.orders.filter(order => order.side === "SELL").every(order => Number(order.feeUsd) > 0));
});

test("enforces cumulative turnover including fees and holds unaffordable fills", () => {
  const limited = runPaperStrategy({...input(), maxTurnoverUsd: 20});
  assert.equal(limited.orders.length, 1);
  assert.equal(limited.summary.turnoverUsd, "20.000000");
  assert.ok(limited.rejections.some(item => item.reason.includes("turnover")));
  const unfunded = runPaperStrategy({...input(), initialCashUsd: 1});
  assert.equal(unfunded.orders.length, 0);
  assert.equal(unfunded.summary.cashUsd, "1.000000");
  assert.ok(unfunded.rejections.some(item => item.reason.includes("balance")));
});

test("SELL cannot spend assets the virtual wallet does not hold; a final signal cannot fill", () => {
  const result = runPaperStrategy(input([10, 20, 30, 40]));
  assert.equal(result.orders.length, 0);
  assert.ok(result.rejections.some(item => item.reason.includes("balance")));
  assert.equal(result.unfilledSignal?.side, "SELL");
});

test("later candle prices cannot alter earlier signals, fills or equity", () => {
  const a = input(), b = input();
  b.candles[5] = {...b.candles[5]!, open: 85, close: 85, low: 84, high: 86};
  const left = runPaperStrategy(a), right = runPaperStrategy(b);
  assert.deepEqual(left.decisions.slice(0, 5), right.decisions.slice(0, 5));
  assert.deepEqual(left.orders.filter(o => o.fillTimeMs < 300000), right.orders.filter(o => o.fillTimeMs < 300000));
  assert.deepEqual(left.equityCurve.slice(0, 5), right.equityCurve.slice(0, 5));
});

test("rejects conflicting signals, unsupported markets, live documents, malformed candles and invalid limits", () => {
  const conflict = input();
  conflict.strategy.nodes.forEach(node => {if (node.type === "indicator.rsi") node.threshold = node.comparison === "lt" ? 100 : 0;});
  assert.throws(() => runPaperStrategy(conflict), /conflicting/i);
  const base = input();
  for (const patch of [
    {strategy: {...base.strategy, networkId: 1}},
    {strategy: {...base.strategy, riskPolicy: {...base.strategy.riskPolicy, paperTradingOnly: false}}},
    {candles: []}, {candles: [...base.candles, base.candles[0]]},
    {candles: base.candles.map((c,i) => i === 1 ? {...c, high: 1} : c)},
    {initialCashUsd: -1}, {initialCashUsd: 0.0000001}, {maxTurnoverUsd: Infinity},
    {feeBps: 0.5}, {slippageBps: 51},
  ]) assert.throws(() => runPaperStrategy({...base,...patch}), {code: "INVALID_EXECUTION_INPUT"});
});
