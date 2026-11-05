import { createSyntheticCandles } from "./replay.js";

export function mountExecution({root=document,getDraft,applyDraft,validateDraft,getApiKey,mayReplace=()=>true,request=fetch}) {
  const $=id=>root.querySelector(`#${id}`);
  const entries=new Map();
  let busy=false,sequence=0,controller,lastDraft=JSON.stringify(getDraft());
  const status=message=>{$("execution-status").textContent=message;};
  function element(tag,text,className) {
    const node=root.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function refresh() {
    const ai=$("execution-mode").value==="AI";
    $("execution-start").disabled=busy||!validateDraft(getDraft()).valid||(ai&&!getApiKey());
    $("execution-stop").disabled=!busy;
    $("execution-help").textContent=ai?(getApiKey()?"Uses your 0G balance for at most two inference requests. Trades remain paper-only.":"Add your 0G key using the key icon, or select local replay to try without AI."):"Local rules replay uses no AI key and sends no request to 0G or Flash.";
  }
  function invalidate(message="Run cleared because its inputs changed.") {
    sequence++;controller?.abort();controller=undefined;busy=false;
    $("execution-results").hidden=true;$("execution-results").replaceChildren();
    status(message);refresh();
  }
  function choose(entry) {
    if(!mayReplace())return;
    invalidate("Strategy loaded. Review limits, then start a paper run.");
    lastDraft=JSON.stringify(entry.strategy);
    applyDraft(structuredClone(entry.strategy));
    $("execution-selected").textContent=`${entry.strategy.name} · version ${entry.versionId}`;
    refresh();
  }
  function addUnlockedStrategy(entry) {
    if(!entry||typeof entry.versionId!=="string"||!entry.versionId.trim()||entry.versionId.length>128||!validateDraft(entry.strategy).valid||entry.strategy.riskPolicy.paperTradingOnly!==true)throw new Error("Supply a valid paper strategy and its unlocked version ID.");
    const key=JSON.stringify([entry.strategy.strategyId,entry.versionId]);
    if(entries.has(key)&&JSON.stringify(entries.get(key).strategy)!==JSON.stringify(entry.strategy))throw new Error("This version is already loaded with different rules.");
    if(!entries.has(key)&&entries.size>=20)throw new Error("This demo supports up to 20 unlocked strategy cards.");
    entries.set(key,structuredClone({strategy:entry.strategy,versionId:entry.versionId}));
    $("execution-library").replaceChildren();
    for(const [id,item] of entries) {
      const card=element("button",undefined,"unlocked-card");card.type="button";card.draggable=true;
      card.append(element("strong",item.strategy.name),element("small",`Version ${item.versionId} · drag or click to load`));
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
      const card=element("div",undefined,"creator-card");
      card.append(element("strong",creator.name),element("small","Following"));
      $("creator-library").append(card);
    }
    $("creators-empty").hidden=creators.length>0;
  }
  $("canvas").addEventListener("drop",event=>{
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
  $("execution-stop").addEventListener("click",()=>invalidate("Stopped. Pending results were discarded. An already accepted AI request may still be charged."));
  function renderResults(data) {
    const result=data.execution,summary=result.summary;
    const output=$("execution-results");output.replaceChildren();
    output.append(element("h3",`${summary.tradeCount} filled paper trades · ${data.agentMode==="REAL_0G"?"0G AI tool execution":"Local rules replay"}`));
    output.append(element("p",`Final value $${summary.finalValueUsd} · Net P&L $${summary.netPnlUsd} · Cash $${summary.cashUsd} · Base balance ${summary.baseQuantity}`,"small"));
    output.append(element("p",`Turnover including fees $${summary.turnoverUsd} · ${result.rejections.length} rejected fills${result.unfilledSignal?" · Final signal has no next candle to fill":""}.`,"small muted"));
    output.append(element("p",data.explanation,"small"));
    if(data.inference?.length)output.append(element("p",data.inference.map(item=>`${item.model}${item.totalCostNeuron!==undefined?` · ${item.totalCostNeuron} neuron charged`:" · cost not reported"}`).join(" / "),"tiny muted"));
    const scroll=element("div",undefined,"execution-table-wrap"),table=element("table");
    const header=element("tr");
    for(const label of ["Fill time (synthetic UTC)","Side","Base quantity","Notional USD","Fee USD"]) {const cell=element("th",label);cell.setAttribute("scope","col");header.append(cell);}
    const head=element("thead"),body=element("tbody");head.append(header);
    for(const order of result.orders) {
      const row=element("tr");
      for(const value of [new Date(order.fillTimeMs).toISOString(),order.side,order.baseQuantity,order.notionalUsd,order.feeUsd])row.append(element("td",value));
      body.append(row);
    }
    table.append(head,body);scroll.append(table);output.append(scroll);
    const detail=element("details");detail.append(element("summary","Decisions, rejected fills and replay assumptions"),element("pre",JSON.stringify({decisions:result.decisions,rejections:result.rejections,assumptions:result.assumptions},null,2)));
    output.append(detail);output.hidden=false;
  }
  $("execution-start").addEventListener("click",async()=>{
    if(busy)return;
    if(!validateDraft(getDraft()).valid){status("Finish the strategy rules before running.");return;}
    const config=settings(),apiKey=config.mode==="AI"?getApiKey():"";
    if(config.mode==="AI"&&!apiKey){status("Add a 0G inference key first, or choose local replay.");return;}
    invalidate("");
    const current=++sequence,snapshot=JSON.stringify(getDraft()),configSnapshot=JSON.stringify(config);
    controller=new AbortController();busy=true;refresh();
    status(config.mode==="AI"?"AI agent is invoking the paper execution tool. No live orders will be submitted.":"Replaying the strategy on synthetic candles…");
    try {
      const response=await request("/api/execution",{method:"POST",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(75000)]),headers:{"Content-Type":"application/json",...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})},body:JSON.stringify({...config,strategy:JSON.parse(snapshot),candles:createSyntheticCandles()})});
      const payload=await response.json();
      if(current!==sequence)return;
      if(snapshot!==JSON.stringify(getDraft())||configSnapshot!==JSON.stringify(settings())){invalidate("Strategy or limits changed. Start a new run.");return;}
      if(!response.ok||!payload.ok){status(payload.error?.message??"Execution unavailable. No live order was submitted.");return;}
      renderResults(payload.data);status("Paper execution complete. Results are simulated, not live Flash fills.");
    } catch {if(current===sequence)status("The run did not finish. No live order was submitted. Check 0G usage before retrying an AI run.");}
    finally {if(current===sequence){busy=false;controller=undefined;refresh();}}
  });
  $("execution-results").hidden=true;refresh();
  return {addUnlockedStrategy,setFollowedCreators,invalidate,draftChanged(){const now=JSON.stringify(getDraft());if(now!==lastDraft){lastDraft=now;$("execution-selected").textContent="Current edited draft · paper replay only";invalidate("Draft changed. Review it before starting a new run.");}}};
}
