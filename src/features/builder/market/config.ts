import {networks,extraPairs} from "./networks.ts";
export {networks} from "./networks.ts";
// shortcut: market rules span the supported $0.000001–$1,000,000 price domain; extend these bounds if that domain grows.
export const marketPriceBounds={minPriceUsd:0.000001,maxPriceUsd:1000000};
export const isMarketPrice=(rule:{minPriceUsd:number;maxPriceUsd:number})=>rule.minPriceUsd===marketPriceBounds.minPriceUsd&&rule.maxPriceUsd===marketPriceBounds.maxPriceUsd;
import {rsiStrategy} from "../fixtures/rsi-strategy.ts";
import {validateStrategy} from "../validation/strategy.ts";
import type {ValidationContext, ValidationResult, StrategyDefinition} from "../validation/strategy.ts";

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
export const tradingTokens = {
  weth:{symbol:"WETH",reference:"ETH",address:marketContext.tokenAddresses[1]!,decimals:18,feed:"0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",maxAgeSeconds:1200},
  cbbtc:{symbol:"cbBTC",reference:"BTC",address:"0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as const,decimals:8,feed:"0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D",maxAgeSeconds:1200},
  usdc:{symbol:"USDC",reference:"USDC",address:marketContext.tokenAddresses[0]!,decimals:6,feed:"0x1550207eAeB590D1557a6E6C066D3d57B5A4Dc65",maxAgeSeconds:86400},
  usdt:{symbol:"USDT",reference:"USDT",address:"0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2" as const,decimals:6,feed:"0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9",maxAgeSeconds:86400},
};
const basePairs = [
  {id:"eth-usdc",label:"ETH / USDC",base:tradingTokens.weth,quote:tradingTokens.usdc},
  {id:"eth-usdt",label:"ETH / USDT",base:tradingTokens.weth,quote:tradingTokens.usdt},
  {id:"btc-usdc",label:"BTC / USDC",base:tradingTokens.cbbtc,quote:tradingTokens.usdc},
  {id:"btc-usdt",label:"BTC / USDT",base:tradingTokens.cbbtc,quote:tradingTokens.usdt},
];
export type TradingPair = {id:string;label:string;base:{symbol:string;reference:string;address:string;decimals:number;feed:string;maxAgeSeconds:number;native?:boolean;oracleNetwork?:string;wrappedAddress?:string};quote:{symbol:string;reference:string;address:string;decimals:number;feed:string;maxAgeSeconds:number;native?:boolean};network:{key:string;id:number;name:string;family:string;rpc:string;nativeSymbol:string;sequencer?:string;settlement?:string;vault?:string;oracleNetwork?:string}};
export const tradingPairs:TradingPair[]=[...basePairs.map(pair=>({...pair,network:networks.base})),...extraPairs.map(pair=>({...pair,quote:pair.quote??tradingTokens.usdc})),{...basePairs[0]!,id:"base-native-eth-usdc",label:"Native ETH / USDC",base:{...tradingTokens.weth,symbol:"ETH",native:true,wrappedAddress:tradingTokens.weth.address,address:"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},network:networks.base}];
export const tradingContext:ValidationContext={networkId:8453,tokenAddresses:Object.values(tradingTokens).map(token=>token.address)};
export function pairForStrategy(input?:unknown):TradingPair {
  if(input===undefined)return tradingPairs[0]!;
  const strategy=input as {networkId?:number;tokenIn?:string;tokenOut?:string};
  const tags=(strategy as any)?.metadata?.tags;
  const explicit=Array.isArray(tags)?tags.find((tag:unknown)=>typeof tag==="string"&&tag.startsWith("pair:"))?.slice(5):undefined;
  const pair=typeof input==="string"?tradingPairs.find(pair=>pair.id===input):tradingPairs.find(pair=>(!explicit||pair.id===explicit)&&strategy?.networkId===pair.network.id&&typeof strategy.tokenIn==="string"&&typeof strategy.tokenOut==="string"&&(pair.network.family==="solana"?pair.quote.address===strategy.tokenIn&&pair.base.address===strategy.tokenOut:pair.quote.address.toLowerCase()===strategy.tokenIn.toLowerCase()&&pair.base.address.toLowerCase()===strategy.tokenOut.toLowerCase()));
  if(!pair)throw new Error("Choose a supported trading pair and network.");return pair;
}
export function strategyForPair(id:string,basis?:StrategyDefinition){
  const pair=pairForStrategy(id),btc=pair.base.symbol==="cbBTC";
  return {...structuredClone(priceStrategy),strategyId:crypto.randomUUID(),name:`${pair.label} price strategy`,networkId:pair.network.id,metadata:{tags:[`pair:${pair.id}`]},description:`Trade ${pair.base.symbol} against ${pair.quote.symbol} on ${pair.network.name} using USD price targets.`,tokenIn:pair.quote.address,tokenOut:pair.base.address,
    riskPolicy:{...structuredClone(basis?.riskPolicy??priceStrategy.riskPolicy),allowlistedTokenAddresses:[pair.quote.address,pair.base.address]},
    edges:structuredClone(basis?.edges??priceStrategy.edges),
    nodes:basis?structuredClone(basis.nodes):priceStrategy.nodes.map(node=>node.type==="signal.price"?{...node,minPriceUsd:btc?60000:2000,maxPriceUsd:btc?70000:2100}:{...node})};
}
export function contextForPair(pair:TradingPair):ValidationContext{return {networkId:pair.network.id,tokenAddresses:[pair.quote.address,pair.base.address] as any};}
export function validatePriceStrategy(input: unknown): ValidationResult {
  let pair:TradingPair;try{pair=pairForStrategy(input);}catch{return {valid:false,issues:[{code:"INVALID_PAIR",path:"$.tokenOut",message:"Choose a registered trading pair and network."}]};}
  const result=validateStrategy(input,contextForPair(pair));
  if(!result.valid)return result;
  try{pairForStrategy(result.strategy);}catch{return {valid:false,issues:[{code:"INVALID_PAIR",path:"$.tokenOut",message:"Choose a registered trading pair on a supported network."}]};}
  if(result.strategy.nodes.some(node=>node.type === "indicator.rsi"))return {valid:false,issues:[{code:"UNSUPPORTED_RULE",path:"$.nodes",message:"This monitor supports price-range rules only. Candle-based indicators are unsupported."}]};
  return result;
}
