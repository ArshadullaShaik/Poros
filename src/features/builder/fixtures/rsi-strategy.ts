import type { StrategyDefinition, ValidationContext } from "../validation/strategy.ts";

// Local test addresses only; never use this fixture as a live token registry.
export const fixtureContext: ValidationContext = {
  networkId: 31337,
  tokenAddresses: ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002"],
};

export const rsiStrategy: StrategyDefinition = {
  schemaVersion: "1",
  strategyId: "fixture-rsi",
  name: "Paper RSI example",
  description: "Local fixture: buy below RSI 30, sell above RSI 70, $20 per order.",
  networkId: 31337,
  tokenIn: fixtureContext.tokenAddresses[0]!,
  tokenOut: fixtureContext.tokenAddresses[1]!,
  nodes: [
    { id: "buy-signal", type: "indicator.rsi", period: 14, comparison: "lt", threshold: 30 },
    { id: "buy-guard", type: "guard.risk" },
    { id: "buy", type: "action.intent", side: "BUY", notionalUsd: 20 },
    { id: "sell-signal", type: "indicator.rsi", period: 14, comparison: "gt", threshold: 70 },
    { id: "sell-guard", type: "guard.risk" },
    { id: "sell", type: "action.intent", side: "SELL", notionalUsd: 20 },
  ],
  edges: [
    { id: "buy-signal-guard", source: "buy-signal", target: "buy-guard" },
    { id: "buy-guard-action", source: "buy-guard", target: "buy" },
    { id: "sell-signal-guard", source: "sell-signal", target: "sell-guard" },
    { id: "sell-guard-action", source: "sell-guard", target: "sell" },
  ],
  riskPolicy: {
    maxNotionalUsd: 20,
    maxSlippageBps: 50,
    allowlistedTokenAddresses: [...fixtureContext.tokenAddresses],
    paperTradingOnly: true,
  },
};
