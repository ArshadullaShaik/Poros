import {connectSolanaWallet,signSolanaSetup,signSolanaOrderMessage} from "./solana-wallet.js";
import {connectBrowserWallet,signFlashOrder} from "./wallet.js";
export function mountExecution({root=document,getDraft,applyDraft,validateDraft,getApiKey,mayReplace=()=>true,request=fetch,onActivity=()=>{},getPair=()=>({id:"eth-usdc",base:{symbol:"WETH",reference:"ETH"},quote:{symbol:"USDC"}})}) {
  const $=id=>root.querySelector(`#${id}`);
  const setText=(id,text)=>{const node=$(id);if(node)node.textContent=text;};
  const entries=new Map();
  let sessionId,timer,wallet,walletNetwork,solanaConnection,walletBusy=false;
  let busy=false,sequence=0,controller,lastDraft=JSON.stringify(getDraft()),market,marketLoading=false;
  const notify=event=>{try{onActivity({pairId:getPair().id,time:Date.now(),...event});}catch{/* Chart rendering must never interrupt execution. */}};
  const status=message=>{$("execution-status").textContent=message;notify({kind:"status",message});};
  function element(tag,text,className) {
    const node=root.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function refresh() {
    const ai=["AI","LIVE"].includes($("execution-mode").value);
    $("execution-start").disabled=busy||!validateDraft(getDraft()).valid||(ai&&!getApiKey())||!marketReady();
    $("execution-stop").disabled=!busy;
    if($("wallet-connect"))$("wallet-connect").disabled=busy;
    $("execution-help").textContent=$("execution-mode").value==="LIVE"?"Real funds on the selected network. 0G prepares the order at your target; your browser wallet must approve and sign. Stop does not cancel submitted orders or revoke token approvals.":ai?(getApiKey()?"0G invokes the execution tool when a target matches. Waiting uses no inference. Virtual funds only.":"Add your 0G key using the key icon, or select local replay to try without AI."):"Local live-price monitoring without AI inference. Virtual funds only.";
  }
  const marketReady=()=>market&&!market.stale&&(market.pairId??"eth-usdc")===getPair().id;
  async function refreshMarket() {
    if(marketLoading)return;
    marketLoading=true;
    const pairId=getPair().id;
    try {
      const response=await request(`/api/market?pair=${encodeURIComponent(pairId)}`,{signal:AbortSignal.timeout(30000),cache:"no-store"});
      const payload=await response.json(),data=payload.data;
      if(!response.ok||!payload.ok)throw new Error(payload.error?.message??"Market data is unavailable.");
      if(data?.source!=="CHAINLINK_FLASH"||typeof data.stale!=="boolean"||(data.priceUsd!==null&&(typeof data.priceUsd!=="string"||!/^\d+\.\d{6}$/.test(data.priceUsd))))throw new Error("Market data response is invalid.");
      if(getPair().id!==pairId)return;
      if(data.pairId&&data.pairId!==pairId)throw new Error("Market data is for another trading pair.");
      market=data;
      setText("market-price",data.priceUsd?`${getPair().base.reference} $${data.priceUsd} · ${getPair().base.symbol}/${getPair().quote.symbol} · ${getPair().network?.name??"Base"}`:"Loading price sources…");
      setText("market-status",data.stale?"Prices are stale or failed their checks. Waiting for fresh sources.":"Live Chainlink + Flash checks passed · Checks every 10 seconds · Ready to monitor.");
    } catch(error) {market=undefined;setText("market-price","Market data unavailable");setText("market-status",error.message??"Market data is unavailable.");}
    finally {marketLoading=false;refresh();}
  }
  function invalidate(message="Run cleared because its inputs changed.",keepResults=false) {
    clearTimeout(timer);
    if(sessionId){void request("/api/monitor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"stop",id:sessionId}),keepalive:true}).catch(()=>{});sessionId=undefined;}
    walletBusy=false;
    sequence++;controller?.abort();controller=undefined;busy=false;
    if(!keepResults){$("execution-results").hidden=true;$("execution-results").replaceChildren();}
    status(message);refresh();
  }
  async function choose(entry) {
    if(!mayReplace())return false;
    invalidate("Loading creator strategy…");
    const current=sequence,snapshot=JSON.stringify(getDraft());
    try {
      let strategy=entry.strategy;
      if(!strategy){
        const apiKey=getApiKey();
        if(!apiKey)throw new Error("Add your 0G key first. The interpreter reads creator text separately from the execution agent.");
        busy=true;controller=new AbortController();refresh();
        status("Interpreter is reading the creator’s text. This uses one 0G request; no trade starts.");
        const response=await request("/api/interpret",{method:"POST",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`},body:JSON.stringify({name:entry.name,text:entry.text})});
        const payload=await response.json();
        if(current!==sequence)return;
        if(!response.ok||!payload.ok)throw new Error(payload.error?.message??"Creator text could not be interpreted.");
        if(payload.data.status!=="READY")throw new Error(`Creator must clarify: ${(payload.data.questions??[]).join(" ")}`);
        strategy=payload.data.strategy;
      }
      if(current!==sequence||JSON.stringify(getDraft())!==snapshot)return;
      if(!validateDraft(strategy).valid)throw new Error("The interpreter returned unsupported rules. Current canvas is unchanged.");
      lastDraft=JSON.stringify(strategy);applyDraft(structuredClone(strategy));
      if($("creator-text"))$("creator-text").textContent=entry.text?`Creator instructions: ${entry.text}`:"";
      $("execution-selected").textContent=`${strategy.name} · version ${entry.versionId} · each action once per run`;
      status("Review the interpreted price ranges and amounts on the canvas, then Run to monitor.");
      return true;
    }catch(error){if(current===sequence)status(error.message);return false;}
    finally{if(current===sequence){busy=false;controller=undefined;refresh();}}
  }
  function validateEntry(entry) {
    if(!entry||typeof entry.versionId!=="string"||!entry.versionId.trim()||entry.versionId.length>128||
      (entry.strategy? !validateDraft(entry.strategy).valid||entry.strategy.riskPolicy.paperTradingOnly!==true : typeof entry.id!=="string"||!entry.id.trim()||entry.id.length>128||typeof entry.name!=="string"||!entry.name.trim()||entry.name.length>100||typeof entry.text!=="string"||!entry.text.trim()||entry.text.length>4000))throw new Error("Supply an unlocked creator text strategy with ID, name and version, or validated price rules.");
  }
  function addUnlockedStrategy(entry) {
    validateEntry(entry);
    const key=JSON.stringify([entry.strategy?.strategyId??entry.id,entry.versionId]);
    if(entries.has(key)&&JSON.stringify(entries.get(key))!==JSON.stringify(entry))throw new Error("This version is already loaded with different rules.");
    if(!entries.has(key)&&entries.size>=20)throw new Error("This demo supports up to 20 unlocked strategy cards.");
    entries.set(key,structuredClone(entry));
    $("execution-library").replaceChildren();
    for(const [id,item]of entries){
      const card=element("button",undefined,"unlocked-card");card.type="button";card.draggable=true;
      card.append(element("strong",item.name??item.strategy.name),element("small",`Version ${item.versionId} · ${item.text?"text interpreted on load (0G cost)":"validated rules"} · drag or click`));
      card.addEventListener("click",()=>choose(item));
      card.addEventListener("dragstart",event=>{event.dataTransfer.setData("text/plain",JSON.stringify({kind:"unlocked-strategy",id}));event.dataTransfer.effectAllowed="copy";});
      $("execution-library").append(card);
    }
  }
  function setFollowedCreators(creators) {
    if(!Array.isArray(creators)||creators.length>100||creators.some(creator=>
      !creator||typeof creator.id!=="string"||!creator.id.trim()||creator.id.length>128||
      typeof creator.name!=="string"||!creator.name.trim()||creator.name.length>100
    )||new Set(creators.map(creator=>creator.id)).size!==creators.length)throw new Error("Supply a list of followed creators with unique IDs and names.");
    $("creator-library").replaceChildren();
    for(const creator of creators) {
      const card=element("a",undefined,"creator-card");
      card.href=`/community#/profile/${encodeURIComponent(creator.id)}`;
      card.append(element("strong",creator.name),element("small","View creator on community page ↗"));
      $("creator-library").append(card);
    }
    $("creators-empty").hidden=creators.length>0;
  }
  $("canvas").addEventListener("drop",event=>{
    if (!event.dataTransfer.getData("text/plain").startsWith('{')) return;
    try {
      const payload=JSON.parse(event.dataTransfer.getData("text/plain"));
      if(payload.kind!=="unlocked-strategy")return;
      event.preventDefault();event.stopImmediatePropagation();$("canvas").classList.remove("drag-over");
      if(!entries.has(payload.id))throw new Error();
      choose(entries.get(payload.id));
    }
    catch {status("Drop a strategy from the unlocked library, or click its card.");}
  },true);
  function settings() {
    return {mode:$("execution-mode").value,initialCashUsd:Number($("execution-capital").value),maxTurnoverUsd:Number($("execution-turnover").value),feeBps:Number($("execution-fee").value),slippageBps:Number($("execution-slippage").value)};
  }
  for(const id of ["execution-mode","execution-capital","execution-turnover","execution-fee","execution-slippage"])$(id).addEventListener("change",()=>invalidate("Execution settings changed. Start a new paper run to use them."));
  $("execution-stop").addEventListener("click",()=>invalidate("Stopped. Pending AI may still be charged. Submitted Flash orders may still fill; their IDs remain below.",true));
  function renderResults(data) {
    notify({kind:"snapshot",data:{...data,wallet:data.wallet??(walletNetwork===getPair().network?.id?wallet:undefined)}});
    const output=$("execution-results");output.replaceChildren();
    output.append(element("h3",`${data.status} · ${data.mode==="LIVE"?"LIVE Flash orders":`${data.orders.length} paper fills`}`));
    if(data.mode==="LIVE"){
      output.append(element("p",`Remaining run buy budget $${data.cashUsd} · Reserved order notional $${data.turnoverUsd}. Wallet balances and gas are separate.`,"small"));
      for(const order of data.liveOrders??[])output.append(element("p",`${order.side} $${order.notionalUsd} · ${order.orderId} · ${order.status}`,"small"));
      if(data.walletRequest){
        const quote=data.walletRequest;
        output.append(element("p",`${quote.side} $${quote.notionalUsd} · Flash quote $${quote.effectivePriceUsd} · receives approximately ${quote.expectedReceive} ${quote.side==="BUY"?(quote.baseSymbol??"WETH"):(quote.quoteSymbol??"USDC")}.`,"small"));
        const approve=element("button",walletBusy?"Waiting for your wallet…":"Approve and sign in wallet","button primary");approve.type="button";approve.disabled=walletBusy;
        approve.addEventListener("click",async()=>{
          if(walletBusy)return;
          const current=sequence;walletBusy=true;approve.disabled=true;status("Approve the exact token amount, then sign the Flash order in your wallet.");
          try{
            let signature;
            if(quote.family==="solana"){
              if(!solanaConnection||solanaConnection.address!==quote.funderAddress)throw new Error("Reconnect your Solana wallet.");
              for(const setup of quote.setupTxs??[]){
                const signedSetupTx=await signSolanaSetup(setup,solanaConnection.account,solanaConnection.wallet,controller.signal);
                const result=await postMonitor({action:"setup",id:sessionId,signedSetupTx},AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));
                if(result.setupStatus!=="confirmed")throw new Error("Solana setup is pending. Check the transaction before retrying.");
              }
              signature=await signSolanaOrderMessage(quote,solanaConnection.account,solanaConnection.wallet,controller.signal);
            }else signature=await signFlashOrder(quote,controller.signal);
            if(current!==sequence)return;
            const result=await postMonitor({action:"submit",id:sessionId,signature},AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]));
            if(current!==sequence)return;renderResults(result);status(result.message);
          }catch(error){if(current===sequence)invalidate(error.code===4001?"Wallet request declined. Monitoring stopped.":error.message);}
          finally{walletBusy=false;}
        });output.append(approve);
      }
      output.hidden=false;return;
    }
    output.append(element("p",`Virtual cash $${data.cashUsd} · ${data.pair?.baseSymbol??"WETH"} ${data.baseQuantity} · Turnover $${data.turnoverUsd}`,"small"));
    output.append(element("p","Current live prices only. Each action executes once per run. No wallet trade is submitted.","tiny muted"));
    for(const fill of data.orders)output.append(element("p",`${new Date(fill.filledAtMs).toISOString()} · ${fill.side} $${fill.notionalUsd} · ${fill.baseQuantity} ${data.pair?.baseSymbol??"WETH"} · simulated price $${fill.priceUsd}`,"small"));
    for(const inference of data.inference??[])output.append(element("p",`0G execution · ${inference.model}${inference.totalCostNeuron!==undefined?` · ${inference.totalCostNeuron} neuron charged`:""}`,"tiny muted"));
    output.hidden=false;
  }
  async function postMonitor(body,signal) {
    const apiKey=["AI","LIVE"].includes($("execution-mode").value)?getApiKey():"";
    const response=await request("/api/monitor",{method:"POST",signal,headers:{"Content-Type":"application/json",...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify(body)});
    const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error?.message??"Monitor unavailable.");return payload.data;
  }
  $("execution-start").addEventListener("click",async()=>{
    if(busy)return;
    if(!validateDraft(getDraft()).valid){status("Finish the strategy rules before running.");return;}
    if(!marketReady()){status("Wait for fresh Chainlink / Flash prices before running.");return;}
    const config=settings();
    if(["AI","LIVE"].includes(config.mode)&&!getApiKey()){status("Add your 0G key first.");return;}
    if(config.mode==="LIVE"&&(!wallet||walletNetwork!==(getPair().network?.id??8453))){status("Connect your wallet on the selected network before live execution.");return;}
    invalidate("");const current=++sequence;controller=new AbortController();busy=true;refresh();
    const signal=()=>AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);
    async function tick(){
      try{
        const data=await postMonitor({action:"check",id:sessionId},signal());
        if(current!==sequence)return;
        renderResults(data);status(data.message);
        if(["STOPPED","ERROR","COMPLETED"].includes(data.status)){busy=false;sessionId=undefined;refresh();return;}
        timer=setTimeout(()=>{void tick();},10000);timer.unref?.();
      }catch(error){if(current===sequence){invalidate(error.message??"Monitor stopped. Check 0G usage before restarting.");}}
    }
    try{
      const strategy=structuredClone(getDraft());
      if(config.mode==="LIVE"&&strategy.riskPolicy.paperTradingOnly)throw new Error("Enable live mode in the strategy before using real funds.");
      const data=await postMonitor({action:"start",...config,...(config.mode==="LIVE"?{wallet}:{}),strategy},signal());
      if(current!==sequence){void request("/api/monitor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"stop",id:data.id})}).catch(()=>{});return;}
      sessionId=data.id;status("Monitoring current price. Waiting uses no AI requests.");await tick();
    }catch(error){if(current===sequence)invalidate(error.message??"Could not start the monitor.");}
  });
  $("wallet-connect")?.addEventListener("click",async()=>{
    try{
      const network=getPair().network??{id:8453,name:"Base",family:"evm"};
      if(network.family==="solana"){solanaConnection=await connectSolanaWallet();wallet=solanaConnection.address;}else wallet=await connectBrowserWallet(undefined,network);
      walletNetwork=network.id;$("wallet-connect").textContent=`${wallet.slice(0,6)}…${wallet.slice(-4)} · ${network.name}`;status("Wallet connected. Review the network and live trading limits.");
    }
    catch(error){status(error.code===4001?"Wallet connection declined.":error.message);}
  });
  root.defaultView?.ethereum?.on?.("accountsChanged",()=>{wallet=undefined;invalidate("Wallet account changed. Reconnect before running live.");if($("wallet-connect"))$("wallet-connect").textContent="Connect wallet";});
  root.defaultView?.ethereum?.on?.("chainChanged",()=>invalidate("Wallet network changed. Reconnect on the selected network before Run."));
  root.defaultView?.addEventListener("pagehide",()=>invalidate("Monitoring stopped because this tab closed."));
  $("execution-results").hidden=true;refresh();
  return {openUnlockedReference(id){if(!entries.has(id))throw new Error("Drop a strategy from the unlocked library.");return choose(entries.get(id));},clearUnlockedStrategies(){entries.clear();$("execution-library").replaceChildren();},addUnlockedStrategy,openUnlockedStrategy(entry){validateEntry(entry);return choose(structuredClone(entry));},setFollowedCreators,refreshMarket,invalidate,draftChanged(){const now=JSON.stringify(getDraft());if(now!==lastDraft){lastDraft=now;$("execution-selected").textContent="Current edited draft · live price monitor";invalidate("Draft changed. Review it before starting a new run.");if((market?.pairId??"eth-usdc")!==getPair().id){market=undefined;void refreshMarket();}}}};
}
