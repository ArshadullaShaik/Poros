import {createSolanaOrders} from "./solana-orders.ts";
import {readBoundedJson} from "../ai/zero-g.ts";
import {pairForStrategy,tradingPairs} from "../market/config.ts";
import {FlashError} from "../market/flash.ts";
export const FLASH_ALLOWANCE="0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78";
const same=(a:unknown,b:string)=>typeof a==="string"&&a.toLowerCase()===b.toLowerCase();
const address=(a:unknown)=>typeof a==="string"&&/^0x[0-9a-fA-F]{40}$/.test(a)&&!/^0x0{40}$/i.test(a);
function units(value:unknown,decimals:number){
  if(typeof value!=="string"||!/^\d{1,18}(?:\.\d{1,36})?$/.test(value))throw new FlashError("Flash returned an invalid amount.");
  const [whole,fraction=""]=value.split(".");if(fraction.slice(decimals).replace(/0/g,""))throw new FlashError("Flash amount exceeds token precision.");
  return BigInt(whole+fraction.slice(0,decimals).padEnd(decimals,"0"));
}
function decimal(value:bigint,places:number){const digits=value.toString().padStart(places+1,"0");return digits.slice(0,-places)+"."+digits.slice(-places);}
export function validateWalletQuote(quote:any,order:any,now=Date.now()){
  const pair=order.pairId?pairForStrategy(order.pairId):order.targetAsset||order.contraAsset?pairForStrategy({networkId:tradingPairs.find(p=>p.network.key===order.targetChain)?.network.id??8453,tokenIn:order.contraAsset,tokenOut:order.targetAsset}):pairForStrategy();
  const baseToken=pair.base.native?pair.base.wrappedAddress!:pair.base.address;
  const buy=order.side==="buy",from=buy?pair.quote.address:baseToken,to=buy?baseToken:pair.quote.address,decimals=buy?pair.quote.decimals:pair.base.decimals;
  if(!quote||typeof quote.quoteId!=="string"||!/^[-\w]{1,128}$/.test(quote.quoteId)||quote.side!==order.side||quote.orderType!=="market"||!same(quote.targetAsset,baseToken)||!same(quote.contraAsset,pair.quote.address)||quote.from?.asset!==(buy?"contra":"target")||quote.to?.asset!==(buy?"target":"contra")||units(quote.from.amount,decimals)!==units(order.qty,decimals)||units(quote.to.amount,buy?pair.base.decimals:pair.quote.decimals)<=0n||quote.svm||quote.attachedBracket||quote.bridgeQuoteId||quote.evm?.permitTypedData)throw new FlashError("Flash returned an unexpected wallet quote.");
  let typed;try{typed=JSON.parse(quote.evm.orderTypedData);}catch{throw new FlashError("Flash returned invalid signing data.");}
  const message=typed?.message;
  const fields=[{name:"swapper",type:"address"},{name:"vault",type:"address"},{name:"recipient",type:"address"},{name:"fromToken",type:"address"},{name:"toToken",type:"address"},{name:"fromAmount",type:"uint256"},{name:"salt",type:"uint256"},{name:"deadline",type:"uint256"}];
  if(typed.primaryType!=="FlashOrder"||typed.domain?.name!=="DefinitiveFlashAllowance"||typed.domain?.version!=="1"||String(typed.domain?.chainId)!==String(pair.network.id)||!same(typed.domain?.verifyingContract,pair.network.settlement!)||JSON.stringify(typed.types?.FlashOrder)!==JSON.stringify(fields)||Object.keys(typed.types??{}).sort().join()!=="EIP712Domain,FlashOrder"||JSON.stringify(typed.types.EIP712Domain)!==JSON.stringify([{name:"name",type:"string"},{name:"version",type:"string"},{name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}])||Object.keys(typed.domain).sort().join()!=="chainId,name,verifyingContract,version"||!message||Object.keys(message).sort().join()!==fields.map(field=>field.name).sort().join()||!same(message.swapper,order.funderAddress)||!same(message.recipient,order.funderAddress)||!same(message.vault,pair.network.vault!)||!same(message.fromToken,from)||!same(message.toToken,to)||!/^\d{1,78}$/.test(message.fromAmount)||BigInt(message.fromAmount)!==units(order.qty,decimals)||!/^\d{1,78}$/.test(message.salt)||!/^\d{1,12}$/.test(message.deadline)||Number(message.deadline)*1000<=now+10000||Number(message.deadline)*1000>now+600000)throw new FlashError("Flash signing payload does not match the approved wallet, pair, amount or deadline.");
  let wrapTx=null;
  if(quote.wrap){
    const wrap=quote.wrap.evmTx;
    if(!pair.base.native||buy||!wrap||!same(quote.wrap.wrappedAsset,baseToken)||!same(wrap.to,baseToken)||wrap.data!=="0xd0e30db0"||typeof wrap.value!=="string"||!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(wrap.value)||BigInt(wrap.value)!==units(order.qty,18))throw new FlashError("Unexpected native wrapping transaction.");
    wrapTx={to:wrap.to,data:wrap.data,value:"0x"+BigInt(wrap.value).toString(16)};
  }
  const approval=quote.evm.approveTx;
  if(approval){
    const expected="0x095ea7b3"+pair.network.settlement!.slice(2).toLowerCase().padStart(64,"0")+units(order.qty,decimals).toString(16).padStart(64,"0");
    if(!same(approval.to,from)||typeof approval.data!=="string"||approval.data.toLowerCase()!==expected||approval.value&&BigInt(approval.value)!==0n)throw new FlashError("Flash approval exceeds the exact order allowance or targets an unexpected contract.");
  }
  return {networkId:pair.network.id,networkName:pair.network.name,wrapTx,quoteId:quote.quoteId,typedData:quote.evm.orderTypedData,approveTx:approval?{to:approval.to,data:approval.data}:null,deadlineMs:Number(message.deadline)*1000};
}
export function createFlashOrders({fetcher=fetch,now=Date.now,apiKey=process.env.FLASH_API_KEY??"dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b",rpcUrl=undefined as string|undefined}={}){
  const solana=createSolanaOrders({fetcher,now,apiKey});
  async function request(path:string,body?:object,signal?:AbortSignal){
    const active=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
    let response;
    try{response=await fetcher("https://flash.definitive.fi/v1"+path,{method:body?"POST":"GET",signal:active,redirect:"error",headers:{"Content-Type":"application/json","x-definitive-api-key":apiKey},...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw new FlashError(path==="/order"?"Order submission outcome is unknown. Do not retry; check Flash orders for this wallet.":"Flash request could not complete.");}
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw new FlashError(`Flash request failed (HTTP ${response.status}). No automatic order retry was made.${path==="/order"?" Check wallet orders before starting another run.":""}`);}
    try{return await readBoundedJson(response,262144,"INVALID_OUTPUT",active);}catch{throw new FlashError(path==="/order"?"Order response was invalid; submission outcome is unknown. Check wallet orders before retrying.":"Flash returned an invalid response.");}
  }
  async function prepare({action,condition,funderAddress,priceUsd,quotePriceUsd="1.000000",maxSlippageBps,pairId="eth-usdc"}:any,signal?:AbortSignal){
    if(pairForStrategy(pairId).network.family==="solana")return solana.prepare({action,condition,funderAddress,priceUsd,quotePriceUsd,maxSlippageBps,pairId},signal);
    if(!address(funderAddress))throw new FlashError("Connect a browser wallet before live execution.");
    const pair=pairForStrategy(pairId),buy=action.side==="BUY",price=Number(priceUsd),quoteUsd=Number(quotePriceUsd),notional=Number(action.notionalUsd);
    if(!Number.isFinite(quoteUsd)||quoteUsd<=0||!Number.isFinite(price)||price<=0||!Number.isFinite(notional)||notional<=0||notional>20||!Number.isInteger(maxSlippageBps)||maxSlippageBps<0||maxSlippageBps>500)throw new FlashError("Invalid live order limits.");
    const spentDecimals=buy?pair.quote.decimals:pair.base.decimals;
    const qty=decimal(BigInt(Math.floor(notional*1e6))*10n**BigInt(spentDecimals)/BigInt(Math.round((buy?quoteUsd:price)*1e6)),spentDecimals);
    if(units(qty,spentDecimals)<=0n)throw new FlashError("Order amount is below this token’s precision.");
    const order={targetChain:pair.network.key,contraChain:pair.network.key,targetAsset:pair.base.native?(pair.base.wrappedAddress!):pair.base.address,contraAsset:pair.quote.address,side:buy?"buy":"sell",qty,orderType:"market",maxSlippage:(maxSlippageBps/10000).toFixed(4),funderAddress};
    async function balanceOf(native=false){
      const response=await fetcher(rpcUrl??(pair.network.key==="base"?process.env.BASE_RPC_URL:undefined)??pair.network.rpc,{method:"POST",headers:{"Content-Type":"application/json"},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:"error",body:JSON.stringify({jsonrpc:"2.0",id:1,method:native?"eth_getBalance":"eth_call",params:native?[funderAddress,"latest"]:[{to:buy?pair.quote.address:(pair.base.wrappedAddress??pair.base.address),data:"0x70a08231"+funderAddress.slice(2).padStart(64,"0")},"latest"]})});
      if(!response.ok)throw new FlashError("Cannot verify the live wallet token balance.");
      const balance=await readBoundedJson(response,16384);
      if(balance?.id!==1||balance.error||typeof balance.result!=="string"||!/^0x[0-9a-fA-F]{1,64}$/.test(balance.result))throw new FlashError("Invalid wallet balance data.");return BigInt(balance.result);
    }
    const required=units(qty,spentDecimals);
    let useNative=false;
    if(await balanceOf()<required){if(!buy&&pair.base.native&&await balanceOf(true)>required)useNative=true;else throw new FlashError("The wallet has insufficient tokens for this order.");}
    const quote=await request("/quote",{...order,...(useNative?{targetAsset:"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}:{}),evmUsePermit2:false,forceMinimalAllowance:true},signal);
    if(useNative&&!quote.wrap)throw new FlashError("Flash did not return the required native wrapping transaction.");
    const signing=validateWalletQuote(quote,{...order,pairId:pair.id},now());
    const received=Number(quote.to.amount),spent=Number(quote.from.amount),effectivePrice=(buy?spent/received:received/spent)*quoteUsd;
    if(!Number.isFinite(effectivePrice)||effectivePrice<condition.minPriceUsd||effectivePrice>condition.maxPriceUsd)throw new FlashError("The executable Flash quote is outside the creator’s price range.");
    return {...signing,order,pairId:pair.id,notionalUsd:notional.toFixed(6),side:action.side,baseSymbol:pair.base.native?"W"+pair.base.reference:pair.base.symbol,quoteSymbol:pair.quote.symbol,quotePriceUsd:quoteUsd.toFixed(6),basePriceUsd:price.toFixed(6),expectedReceive:quote.to.amount,effectivePriceUsd:effectivePrice.toFixed(6)};
  }
  async function revalidate(prepared:any,condition:any,signal?:AbortSignal,quotePriceUsd=prepared.quotePriceUsd??"1.000000",basePriceUsd=prepared.basePriceUsd){
    if(prepared.family==="solana")return solana.revalidate(prepared,condition,signal,quotePriceUsd,basePriceUsd);
    const spentUsd=Number(prepared.order.qty)*Number(prepared.order.side==="buy"?quotePriceUsd:basePriceUsd);
    if(!Number.isFinite(spentUsd)||spentUsd>Number(prepared.notionalUsd)+0.000001)throw new FlashError("Token price moved above the approved USD order cap.");
    const quote=await request("/quote",{...prepared.order,evmUsePermit2:false,forceMinimalAllowance:true},signal);
    validateWalletQuote(quote,{...prepared.order,pairId:prepared.pairId},now());
    const received=Number(quote.to.amount),spent=Number(quote.from.amount),price=(prepared.order.side==="buy"?spent/received:received/spent)*Number(quotePriceUsd);
    if(!Number.isFinite(price)||price<condition.minPriceUsd||price>condition.maxPriceUsd)throw new FlashError("Fresh executable Flash quote is outside the creator’s target range.");
  }
  async function submit(prepared:any,signature:string,signal?:AbortSignal){
    if(prepared.family==="solana")return solana.submit(prepared,signature,signal);
    if(typeof signature!=="string"||!/^0x[0-9a-fA-F]{130}$/.test(signature)||now()+10000>=prepared.deadlineMs)throw new FlashError("The wallet signature is invalid or the quote expired. Start a new run.");
    const result=await request("/order",{...prepared.order,quoteId:prepared.quoteId,evmOrderTypedData:prepared.typedData,userSignature:signature},signal);
    if(typeof result?.orderId!=="string"||!/^[-\w]{1,128}$/.test(result.orderId))throw new FlashError("Flash did not return a valid order ID. Check wallet orders before retrying.");
    return result.orderId;
  }
  async function status(id:string,funderAddress:string,signal?:AbortSignal){
    if(!/^[-\w]{1,128}$/.test(id))throw new FlashError("Invalid Flash order ID.");
    if(!address(funderAddress)&&!(typeof funderAddress==="string"&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(funderAddress)))throw new FlashError("A valid funding wallet is required to check Flash orders.");
    const result=await request(`/orders/${encodeURIComponent(id)}?funderAddress=${encodeURIComponent(funderAddress)}`,undefined,signal),status=result?.order?.status;
    if(typeof status!=="string"||!/^ORDER_STATUS_(PENDING|ACCEPTED|PARTIALLY_FILLED|FILLED|CANCELLED|REJECTED|TERMINATED)$/.test(status))throw new FlashError("Flash returned an unknown order status.");
    return status;
  }
  return {prepare,revalidate,submit,status,setup:solana.setup};
}
