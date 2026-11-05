import {createPublicKey,verify} from 'node:crypto';
import {readBoundedJson} from '../ai/zero-g.ts';
import {pairForStrategy} from '../market/config.ts';
import {FlashError} from '../market/flash.ts';
import {base58Decode,base58Encode} from '../demo/solana-wallet.js';
import {buildSolanaSetup,validateSetupInstructions,verifySignedSetup,associatedTokenAddress} from './solana-transaction.ts';
const DELEGATE='3jBWeQrnfEhw5LY53hwcoYKQJsrTUbtLbmGrNYCr1Fiq';
const fail=(message:string)=>new FlashError(message);
function units(value:string,decimals:number){if(typeof value!=='string'||!/^\d{1,18}(?:\.\d{1,18})?$/.test(value))throw fail('Invalid Solana token quantity.');const [whole,fraction='']=value.split('.');if(fraction.slice(decimals).replace(/0/g,''))throw fail('Solana amount exceeds mint precision.');return BigInt(whole+fraction.slice(0,decimals).padEnd(decimals,'0'));}
function quantity(value:number,price:number,decimals:number){const raw=BigInt(Math.floor(value*1e6))*10n**BigInt(decimals)/BigInt(Math.round(price*1e6)),s=raw.toString().padStart(decimals+1,'0');return s.slice(0,-decimals)+'.'+s.slice(-decimals);}
export function createSolanaOrders({fetcher=fetch,now=Date.now,apiKey=process.env.FLASH_API_KEY??'dpka_513a2bd7_57a2_46d2_927b_2a3857fe271b',rpcUrl=process.env.SOLANA_RPC_URL??'https://api.mainnet-beta.solana.com'}={}){
 async function rpc(method:string,params:any[],signal?:AbortSignal){const active=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);const r=await fetcher(rpcUrl,{method:'POST',signal:active,redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(!r.ok)throw fail('Solana RPC is unavailable.');const data=await readBoundedJson(r,262144,'INVALID_OUTPUT',active);if(data?.id!==1||data.error||data.result===undefined)throw fail('Solana RPC returned invalid data.');return data.result;}
 async function flash(path:string,body:any,signal?:AbortSignal){const active=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);try{const r=await fetcher('https://flash.definitive.fi/v1'+path,{method:body?'POST':'GET',signal:active,redirect:'error',headers:{'Content-Type':'application/json','x-definitive-api-key':apiKey},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){void r.body?.cancel().catch(()=>{});throw fail(`Flash Solana request failed (HTTP ${r.status}).`);}return await readBoundedJson(r,262144,'INVALID_OUTPUT',active);}catch(error){if(path==='/order')throw fail('Solana order submission outcome may be unknown. Check Flash orders before retrying.');throw error instanceof FlashError?error:fail('Flash Solana data is unavailable.');}}
 function checkQuote(q:any,order:any,pair:any){
  const buy=order.side==='buy',decimals=buy?pair.quote.decimals:pair.base.decimals,spentMint=buy?pair.quote.address:pair.base.address;
  if(typeof q?.quoteId!=='string'||!/^[-\w]{1,128}$/.test(q.quoteId)||q.targetAsset!==pair.base.address||q.contraAsset!==pair.quote.address||q.side!==order.side||q.orderType!=='market'||q.evm||q.bridgeQuoteId||q.attachedBracket||q.from?.asset!==(buy?'contra':'target')||q.to?.asset!==(buy?'target':'contra')||units(q.from.amount,decimals)!==units(order.qty,decimals)||units(q.to.amount,buy?pair.base.decimals:pair.quote.decimals)<=0n)throw fail('Unexpected Solana market quote.');
  const s=q.svm,amount=units(order.qty,decimals);
  if(!s||typeof s.orderMessage!=='string'||s.orderMessage.length>2048||!s.orderMessage.startsWith(`DFS|m=${spentMint}|t=${amount}|h=`)||!/^\d{1,20}$/.test(s.nonce)||!/^\d{1,12}$/.test(s.deadline)||Number(s.deadline)*1000<=now()+10000||Number(s.deadline)*1000>now()+600000||!/^DFS\|m=[1-9A-HJ-NP-Za-km-z]{32,44}\|t=\d+\|h=[1-9A-HJ-NP-Za-km-z]{16,24}$/.test(s.orderMessage)||base58Decode(s.orderMessage.split('|h=')[1]).length!==16||s.sponsoredDelegateTx)throw fail('Unsupported or expired Solana signing payload.');
  return s;
 }
 async function quote(order:any,pair:any,signal?:AbortSignal){return flash('/quote',{...order,forceMinimalAllowance:true,...(! (order.side==='buy')&&pair.base.native?{svmUseNativeSOL:true}:{})},signal);}
 async function prepare({action,condition,funderAddress,priceUsd,quotePriceUsd='1.000000',maxSlippageBps,pairId}:any,signal?:AbortSignal){
  if(await rpc("getGenesisHash",[],signal)!=="5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")throw fail("Solana RPC must point to mainnet-beta.");
  const pair=pairForStrategy(pairId),buy=action.side==='BUY';
  if(pair.network.family!=='solana'||base58Decode(funderAddress).length!==32||!Number.isFinite(Number(priceUsd))||Number(priceUsd)<=0||!Number.isFinite(Number(quotePriceUsd))||Number(quotePriceUsd)<=0||action.notionalUsd<=0||action.notionalUsd>20)throw fail('Invalid Solana live order.');
  const qty=quantity(action.notionalUsd,Number(buy?quotePriceUsd:priceUsd),buy?pair.quote.decimals:pair.base.decimals);
  const order={targetChain:'solana',contraChain:'solana',targetAsset:pair.base.address,contraAsset:pair.quote.address,side:buy?'buy':'sell',qty,orderType:'market',maxSlippage:(maxSlippageBps/10000).toFixed(4),funderAddress};
  const amount=units(qty,buy?pair.quote.decimals:pair.base.decimals);
  if(amount<=0n)throw fail('Order is below the mint precision.');
  const spentMint=buy?pair.quote.address:pair.base.address,inputAccount=associatedTokenAddress(funderAddress,spentMint);
  const accounts=await rpc('getTokenAccountsByOwner',[funderAddress,{mint:spentMint},{encoding:'jsonParsed',commitment:'confirmed'}],signal);
  const sufficient=Array.isArray(accounts?.value)&&accounts.value.some((a:any)=>a.pubkey===inputAccount&&a.account?.data?.parsed?.info?.owner===funderAddress&&a.account.data.parsed.info.mint===spentMint&&/^\d+$/.test(a.account.data.parsed.info.tokenAmount?.amount)&&BigInt(a.account.data.parsed.info.tokenAmount.amount)>=amount);
  let useNative=false;
  if(!sufficient){if(!buy&&pair.base.native){const balance=await rpc('getBalance',[funderAddress,{commitment:'confirmed'}],signal);if(!Number.isSafeInteger(balance?.value)||BigInt(balance.value)<=amount+10000000n)throw fail('Insufficient native SOL including setup/rent and network fees.');useNative=true;}else throw fail('Insufficient balance in the Solana associated token account.');}
  const q=await quote(order,{...pair,base:{...pair.base,native:useNative}},signal),s=checkQuote(q,order,pair);
  const effectivePrice=(buy?Number(q.from.amount)/Number(q.to.amount):Number(q.to.amount)/Number(q.from.amount))*Number(quotePriceUsd);
  if(effectivePrice<condition.minPriceUsd||effectivePrice>condition.maxPriceUsd)throw fail('The executable Flash quote is outside the creator’s price range.');
  const ixs=[...(q.svm.ataSetupIxs??[]),...(q.wrap?.svmInstructions??[]),...(q.svm.delegateIx?[q.svm.delegateIx]:[])];
  if(q.wrap&&(!pair.base.native||buy||q.wrap.wrappedAsset!==pair.base.address||q.wrap.evmTx))throw fail('Unexpected Solana wrapping action.');
  const setupTxs:string[]=[];
  if(ixs.length){
   const source=inputAccount;
   if(s.delegateIx&&s.delegateIx.accounts?.[0]?.pubkey!==inputAccount)throw fail("Solana delegation targets an unexpected token account.");
   if(q.wrap&&!source)throw fail('Native SOL setup requires a bound delegation in the same transaction.');
   validateSetupInstructions(ixs,{funder:funderAddress,mints:[pair.base.address,pair.quote.address],delegate:DELEGATE,maxAmount:amount,inputAccount:source,...(q.wrap?{wrappedATA:source}:{})});
   const recent=await rpc('getLatestBlockhash',[{commitment:'confirmed'}],signal);
   setupTxs.push(buildSolanaSetup(ixs,funderAddress,recent?.value?.blockhash));
  }
  return {family:'solana',networkId:101,networkName:'Solana',pairId,order,quoteId:q.quoteId,orderMessage:s.orderMessage,svmNonce:s.nonce,svmDeadline:s.deadline,deadlineMs:Number(s.deadline)*1000,setupTxs,confirmedSetups:0,notionalUsd:action.notionalUsd.toFixed(6),side:action.side,baseSymbol:pair.base.native?"wSOL":pair.base.symbol,quoteSymbol:pair.quote.symbol,quotePriceUsd,basePriceUsd:priceUsd,useNative,expectedReceive:q.to.amount,effectivePriceUsd:effectivePrice.toFixed(6)};
 }
 async function setup(prepared:any,signedSetupTx:string,signal?:AbortSignal){
  const original=prepared.setupTxs[prepared.confirmedSetups];if(!original)throw fail('No Solana setup is awaiting approval.');
  const signature=verifySignedSetup(original,signedSetupTx,prepared.order.funderAddress);
  // Broadcast the exact signed message once. Confirmation polls never ask for another signature.
  const broadcast=await rpc('sendTransaction',[signedSetupTx,{encoding:'base64',skipPreflight:false,maxRetries:0}],signal);
  if(broadcast!==signature)throw fail('Solana RPC returned an unexpected setup signature.');
  const deadline=Math.min(prepared.deadlineMs-10000,now()+20000);
  while(now()<deadline){const result=await rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}],signal);const status=result?.value?.[0];if(status?.err)throw fail('Solana setup transaction failed.');if(status&&['confirmed','finalized'].includes(status.confirmationStatus)){prepared.confirmedSetups++;return {setupStatus:'confirmed',signature};}await new Promise(resolve=>setTimeout(resolve,1000));signal?.throwIfAborted();}
  throw fail(`Solana setup confirmation is pending (${signature}). Check it before starting another run.`);
 }
 async function revalidate(prepared:any,condition:any,signal?:AbortSignal,quoteUsd=prepared.quotePriceUsd,baseUsd=prepared.basePriceUsd){
  const usd=Number(prepared.order.qty)*Number(prepared.order.side==='buy'?quoteUsd:baseUsd);if(!Number.isFinite(usd)||usd>Number(prepared.notionalUsd)+0.000001)throw fail('Token price moved above the approved USD order cap.');
  const pair=pairForStrategy(prepared.pairId),q=await quote(prepared.order,{...pair,base:{...pair.base,native:prepared.useNative}},signal);checkQuote(q,prepared.order,pair);
  const price=(prepared.order.side==='buy'?Number(q.from.amount)/Number(q.to.amount):Number(q.to.amount)/Number(q.from.amount))*Number(quoteUsd);if(!Number.isFinite(price)||price<condition.minPriceUsd||price>condition.maxPriceUsd)throw fail('Fresh executable Flash quote is outside the creator’s target range.');
 }
 async function submit(prepared:any,signature:string,signal?:AbortSignal){
  if(prepared.confirmedSetups!==prepared.setupTxs.length||now()+10000>=prepared.deadlineMs)throw fail('Confirm Solana setup before signing, and use an unexpired quote.');
  const bytes=base58Decode(signature),publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(base58Decode(prepared.order.funderAddress))]),format:'der',type:'spki'});
  if(bytes.length!==64||!verify(null,Buffer.from(prepared.orderMessage),publicKey,bytes))throw fail('Invalid Solana order signature.');
  const result=await flash('/order',{...prepared.order,quoteId:prepared.quoteId,userSignature:signature,svmNonce:prepared.svmNonce,svmDeadline:prepared.svmDeadline},signal);
  if(typeof result?.orderId!=='string'||!/^[-\w]{1,128}$/.test(result.orderId))throw fail('Invalid Solana order response. Check wallet orders before retrying.');return result.orderId;
 }
 return {prepare,setup,revalidate,submit};
}
