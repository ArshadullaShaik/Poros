import {rsiStrategy} from "../fixtures/rsi-strategy.ts";
import {validateStrategy} from "../validation/strategy.ts";
import type {ValidationContext, ValidationResult} from "../validation/strategy.ts";

export const marketContext: ValidationContext = {
  networkId: 8453,
  tokenAddresses: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0x4200000000000000000000000000000000000006"],
};
export const marketStrategy = {
  ...rsiStrategy, strategyId: "base-weth-usdc-rsi", name: "Base WETH / USDC RSI",
  description: "Paper RSI replay on Coinbase ETH/USD historical candles, with Chainlink reference checks and live Flash quotes.",
  networkId: marketContext.networkId, tokenIn: marketContext.tokenAddresses[0]!, tokenOut: marketContext.tokenAddresses[1]!,
  riskPolicy: {...rsiStrategy.riskPolicy, allowlistedTokenAddresses: [...marketContext.tokenAddresses]},
};

export function validateMarketStrategy(input: unknown): ValidationResult {
  const result = validateStrategy(input, marketContext);
  if (!result.valid) return result;
  if (result.strategy.tokenIn.toLowerCase() === marketContext.tokenAddresses[0]!.toLowerCase() &&
      result.strategy.tokenOut.toLowerCase() === marketContext.tokenAddresses[1]!.toLowerCase()) return result;
  return {valid: false, issues: [{code: "INVALID_PAIR", path: "$.tokenOut", message: "Market data requires USDC funding and WETH as the base asset on Base."}]};
}

export const priceStrategy = {
  ...marketStrategy, strategyId:"base-weth-usdc-price", name:"WETH price range example",
  description:"Buy $20 of WETH once when ETH/USD is between $2000 and $2100 inclusive.",
  nodes:[{id:"price",type:"signal.price" as const,minPriceUsd:2000,maxPriceUsd:2100},{id:"risk",type:"guard.risk" as const},{id:"buy",type:"action.intent" as const,side:"BUY" as const,notionalUsd:20}],
  edges:[{id:"price-risk",source:"price",target:"risk"},{id:"risk-buy",source:"risk",target:"buy"}],
};
export function validatePriceStrategy(input: unknown): ValidationResult {
  const result = validateMarketStrategy(input);
  if (!result.valid) return result;
  if (result.strategy.nodes.some(node=>node.type === "indicator.rsi")) return {valid:false,issues:[{code:"UNSUPPORTED_RULE",path:"$.nodes",message:"This monitor supports price-range rules only. Candle-based indicators are unsupported."}]};
  return result;
}
