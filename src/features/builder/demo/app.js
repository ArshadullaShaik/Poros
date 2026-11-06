import { recordExecutionSnapshot } from "../../../../apps/web/src/builder.ts";
import { editStrategy, importStrategyJson, exportStrategyJson } from "../adapters/editor.ts";
import { tradingPairs, marketPriceBounds, isMarketPrice, pairForStrategy, strategyForPair, contextForPair, priceStrategy as defaultStrategy, validatePriceStrategy as validateMarketStrategy } from "../market/config.ts";
import {mountBacktest} from './backtest.js';
import { keepFocus } from "./focus.js";
import { mountCanvasDragTarget } from "./drag-target.js";
import { mountStrategyAi } from "./ai.js";
import { mountExecution } from "./execution.js";
import { mountFundsMode } from "./funds-mode.js";
import { mountLivePrices } from "./prices.js";
import { mountCommunityLibrary, mountLibraryTabs, mountMemberLibrary } from "./community.js";

const $ = selector => document.querySelector(selector);
const canvas = $("#canvas");
let strategyLoads=0;
function setStrategyLoading(loading) {
  strategyLoads+=loading?1:-1;
  $("#strategy-loading").hidden=strategyLoads===0;
  canvas.setAttribute('aria-busy',String(strategyLoads>0));
}
const dialog = $("#import-dialog");
$("#open-run-settings").addEventListener("click", () => $("#run-settings-dialog").showModal());
$("#close-run-settings").addEventListener("click", () => $("#run-settings-dialog").close());
const kinds = {
  "signal.price": {label: "Price range", className: "indicator", icon: "$"},
  "guard.risk": {label: "Risk limit", className: "guard", icon: "◇"},
  "action.intent": {label: "Buy / sell", className: "action", icon: "⇄"},
};
let draft = structuredClone(defaultStrategy);
let selected = draft.nodes[0]?.id;
let positions = new Map();
let connectFrom;
let dirty = false;
let executionUI,pricesUI,communityUI,backtestUI;
let pricesPairId=pairForStrategy(draft).id;
let forkSource;
let strategyLoad=0;

function publishChartContext() {
  window.dispatchEvent(new CustomEvent('poros:strategy-chart', {detail:{
    pairId:pairForStrategy(draft).id,
    ranges:draft.nodes.filter(node=>node.type==='signal.price'&&!isMarketPrice(node)).map(node=>({type:node.type,minPriceUsd:node.minPriceUsd,maxPriceUsd:node.maxPriceUsd})),
  }}));
}
window.addEventListener('poros:request-strategy-chart',publishChartContext);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message) { $("#notice").textContent = message; }
function defaultPosition(index) { return {x: 55 + (index % 3) * 290, y: 75 + Math.floor(index / 3) * 225}; }
function resetPositions() { positions = new Map(draft.nodes.map((node, i) => [node.id, defaultPosition(i)])); }
function edit(operation) {
  try {
    draft = editStrategy(draft, operation);
    dirty = true;
    render();
    return true;
  } catch (error) { announce(error.message); return false; }
}
function select(id) { selected = id; render(); $("#strategy-settings").showModal(); }
function replaceDraft(next,preserveMode=false) {
  forkSource = undefined;
  draft = structuredClone(next);
  draft.riskPolicy.paperTradingOnly = $("#execution-mode").value !== "LIVE";
  selected = draft.nodes[0]?.id;
  connectFrom = undefined;
  resetPositions();
  dirty = false;
  render();
}
function mayReplace() { return !dirty || window.confirm("Replace your current draft? Export JSON first if you want to keep it."); }

function describe(node) {
  if (node.type === "signal.price") return isMarketPrice(node) ? "Market price · once after Run" : `$${node.minPriceUsd} ≤ ${pairForStrategy(draft).base.reference}/USD ≤ $${node.maxPriceUsd}`;
  if (node.type === "guard.risk") return `Maximum $${draft.riskPolicy.maxNotionalUsd} per order`;
  return `${node.side === "BUY" ? "Buy" : "Sell"} · $${node.notionalUsd}`;
}

function connect(target) {
  if (!connectFrom) { announce("First choose the right-hand dot on a source block."); return; }
  const source = connectFrom;
  connectFrom = undefined;
  if (edit({type: "connect", edge: {id: crypto.randomUUID(), source, target}})) announce("Connection added.");
}

function port(node, direction) {
  const button = element("button", `port ${direction}${connectFrom === node.id && direction === "output" ? " connecting" : ""}`);
  button.dataset.focusKey = `port:${direction}:${node.id}`;
  button.ariaLabel = `${direction === "output" ? "Connect from" : "Connect to"} ${node.id}`;
  button.title = button.ariaLabel;
  button.addEventListener("click", event => {
    event.stopPropagation();
    if (direction === "input") connect(node.id);
    else { connectFrom = node.id; render(); announce(`Now choose a left-hand dot to connect from ${kinds[node.type].label}.`); }
  });
  if (direction === "output") {
    button.draggable = true;
    button.addEventListener("dragstart", event => {
      event.stopPropagation();
      event.dataTransfer.setData("text/plain", JSON.stringify({kind: "connection", id: node.id}));
      event.dataTransfer.effectAllowed = "link";
    });
  } else {
    button.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener("drop", event => {
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        if(data.kind!=="connection")return;
        event.preventDefault(); event.stopPropagation();
        if (draft.nodes.some(item => item.id === data.id)) { connectFrom = data.id; connect(node.id); }
      } catch { return; }
      canvas.classList.remove("drag-over");
    });
  }
  return button;
}

function drawEdges() {
  const group = $("#edge-paths");
  group.replaceChildren();
  for (const edge of draft.edges) {
    const from = positions.get(edge.source), to = positions.get(edge.target);
    if (!from || !to) continue;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const x1 = from.x + 220, y1 = from.y + 75, x2 = to.x - 12, y2 = to.y + 75;
    const bend = Math.max(40, Math.abs(x2 - x1) / 2);
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
    path.setAttribute("class", "edge-path");
    path.setAttribute("marker-end", "url(#arrow)");
    group.append(path);
  }
}

function moveNode(id, x, y) {
  const position = {x: Math.max(20, Math.min(canvas.clientWidth - 235, x)), y: Math.max(40, Math.min(3000, y))};
  positions.set(id, position);
  const card = [...canvas.querySelectorAll(".node")].find(item => item.dataset.id === id);
  if (card) { card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; }
  canvas.style.height = `${Math.max(500, ...[...positions.values()].map(point => point.y + 200))}px`;
  drawEdges();
}

function renderNodes(result) {
  canvas.querySelectorAll(".node").forEach(node => node.remove());
  $("#empty-state").hidden = draft.nodes.length !== 0;
  draft.nodes.forEach((node, index) => {
    if (!positions.has(node.id)) positions.set(node.id, defaultPosition(index));
    const position = positions.get(node.id);
    const info = kinds[node.type];
    const invalid = !result.valid && result.issues.some(issue => issue.nodeId === node.id || issue.path === `$.nodes[${index}]` || issue.path.startsWith(`$.nodes[${index}].`));
    const card = element("article", `node ${info.className}${selected === node.id ? " selected" : ""}${invalid ? " invalid" : ""}`);
    card.dataset.id = node.id;
    card.style.left = `${position.x}px`; card.style.top = `${position.y}px`;
    card.append(element("span", "node-number", `${String(index + 1).padStart(2, "0")} / ${node.type === "signal.price" ? "SIGNAL" : node.type === "guard.risk" ? "GUARD" : "ACTION"}`));
    const header = element("button", "node-header");
    header.dataset.focusKey = `title:${node.id}`;
    header.ariaLabel = `Edit ${node.id}; arrow keys move block`;
    header.draggable = true;
    header.append(element("span", "block-icon", info.icon), element("strong", "", info.label), element("span", "grip", "⠿"));
    header.addEventListener("click", () => select(node.id));
    header.addEventListener("dragstart", event => {
      const rect = card.getBoundingClientRect();
      event.dataTransfer.setData("text/plain", JSON.stringify({kind: "move", id: node.id, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top}));
      event.dataTransfer.effectAllowed = "move";
    });
    header.addEventListener("keydown", event => {
      const steps = {ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20]};
      if (steps[event.key]) {
        event.preventDefault();
        const point = positions.get(node.id), [dx, dy] = steps[event.key];
        moveNode(node.id, point.x + dx, point.y + dy);
      } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNode(node.id); }
    });
    const remove = element("button", "icon-button node-remove", "×");
    remove.type = "button";
    remove.ariaLabel = `Remove block ${node.id}`;
    remove.title = "Remove block";
    remove.dataset.focusKey = `remove:${node.id}`;
    remove.addEventListener("click", event => { event.stopPropagation(); removeNode(node.id); });
    card.append(header, remove, element("div", "node-description", describe(node)), element("div", "node-meta", node.type === "signal.price" ? "Checks the current live price" : node.type === "guard.risk" ? `${draft.riskPolicy.maxSlippageBps} bps slippage cap · ${draft.riskPolicy.paperTradingOnly ? "virtual funds" : "LIVE wallet"}` : "Agent executes once when the condition matches"));
    if (node.type !== "signal.price") card.append(port(node, "input"), element("span", "port-label left", "IN"));
    if (node.type !== "action.intent") card.append(port(node, "output"), element("span", "port-label right", "OUT"));
    canvas.append(card);
  });
  canvas.style.height = `${Math.max(500, ...[...positions.values()].map(point => point.y + 200))}px`;
  drawEdges();
}

function field(labelText, value, attributes, change) {
  const label = element("label", "field");
  label.append(element("span", "", labelText));
  const input = element(attributes.options ? "select" : "input");
  input.dataset.focusKey = `setting:${selected}:${labelText}`;
  if (attributes.options) {
    for (const [key, text] of attributes.options) { const option = element("option", "", text); option.value = key; input.append(option); }
  } else {
    for (const [key, val] of Object.entries(attributes)) input.setAttribute(key, val);
  }
  input.value = value;
  input.addEventListener("change", () => change(input.type === "number" ? Number(input.value) : input.value));
  label.append(input);
  return label;
}

function renderSettings() {
  $("#strategy-name").value = draft.name;
  $("#max-slippage").value = draft.riskPolicy.maxSlippageBps;
  $(".paper-label").textContent = draft.riskPolicy.paperTradingOnly ? "Virtual funds only" : "LIVE · browser wallet approval required";
  const node = draft.nodes.find(item => item.id === selected);
  const panel = $("#node-settings");
  panel.replaceChildren();
  $("#delete-node").hidden = !node;
  $("#selected-kind").textContent = node ? kinds[node.type].label : "None";
  if (!node) { panel.append(element("p", "small muted", "Select a block to edit its settings.")); return; }
  const update = settings => edit({type: "updateNode", nodeId: node.id, settings});
  const priceMode = rule => field("Price",isMarketPrice(rule)?"market":"target",{options:[["target","Target price"],["market","Market price"]]},value=>edit({type:"updateNode",nodeId:rule.id,settings:value==="market"?marketPriceBounds:{minPriceUsd:2000,maxPriceUsd:2100}}));
  if (node.type === "signal.price") {
    const market=isMarketPrice(node);
    panel.append(priceMode(node));
    if(market)panel.append(element("p","small muted","Uses a fresh executable quote after Run. Executes once; wallet approval and slippage limits still apply."));
    else panel.append(field("Minimum price (USD, inclusive)", node.minPriceUsd, {type:"number",min:0.000001,max:1000000,step:"any"}, value=>update({minPriceUsd:value})),
      field("Maximum price (USD, inclusive)", node.maxPriceUsd, {type:"number",min:0.000001,max:1000000,step:"any"}, value=>update({maxPriceUsd:value})));
  } else if (node.type === "action.intent") {
    panel.append(field("Action", node.side, {options: [["BUY", "Buy base asset"], ["SELL", "Sell base asset"]]}, value => update({side: value})),
      field("Order size (USD)", node.notionalUsd, {type: "number", min: 0.01, step: 0.01}, value => update({notionalUsd: value})));
    const guard=draft.edges.find(edge=>edge.target===node.id)?.source;
    const source=draft.edges.find(edge=>edge.target===guard)?.source;
    const rule=draft.nodes.find(item=>item.id===source&&item.type==='signal.price');
    if(rule)panel.append(priceMode(rule));
  } else panel.append(element("p", "small muted", "This block checks the order limits below before an action is allowed. Every action needs a risk guard."));
}

function removeNode(id) {
  if (edit({type: "removeNode", nodeId: id})) {
    positions.delete(id);
    if (selected === id) selected = draft.nodes[0]?.id;
    if (connectFrom === id) connectFrom = undefined;
    render();
    announce("Block and its attached connections removed.");
  }
}

function renderConnections() {
  const list = $("#connection-list"); list.replaceChildren();
  if (!draft.edges.length) list.append(element("p", "small muted", "No connections yet."));
  draft.edges.forEach(edge => {
    const source = draft.nodes.find(node => node.id === edge.source), target = draft.nodes.find(node => node.id === edge.target);
    const item = element("div", "connection-item");
    const short = id => String(draft.nodes.findIndex(node => node.id === id) + 1).padStart(2, "0");
    item.append(element("span", "", `${short(edge.source)} ${kinds[source.type].label} → ${short(edge.target)} ${kinds[target.type].label}`));
    const button = element("button", "icon-button", "×");
    button.ariaLabel = `Remove connection ${edge.id}`;
    button.addEventListener("click", () => { edit({type: "disconnect", edgeId: edge.id}); announce("Connection removed."); });
    item.append(button); list.append(item);
  });
}

function renderValidation(result) {
  $("#validation").hidden = result.valid;
  $("#validation-title").textContent = result.valid ? "Strategy is valid" : `${result.issues.length} ${result.issues.length === 1 ? "thing" : "things"} to fix`;
  const list = $("#issues"); list.replaceChildren(); list.hidden = result.valid;
  if (!result.valid) result.issues.forEach(issue => {
    const item = element("li");
    const button = element("button", "", issue.message);
    button.append(element("small", "", issue.path));
    button.addEventListener("click", () => {
      const index = issue.path.match(/^\$\.nodes\[(\d+)\]/)?.[1];
      const id = issue.nodeId ?? draft.nodes[Number(index)]?.id;
      if (id) select(id);
      else announce(`${issue.path}: ${issue.message}`);
    });
    item.append(button); list.append(item);
  });
  $("#export").disabled = !result.valid;
  $("#publish-community").disabled = !result.valid || !draft.riskPolicy.paperTradingOnly;
  $("#export").title = result.valid ? "Save validated strategy JSON" : "Fix validation errors before exporting";
}

function render() {
  keepFocus(document, () => {
    const result = validateMarketStrategy(draft);
    renderNodes(result); renderSettings(); renderConnections(); renderValidation(result);
    $("#block-count").textContent = `${draft.nodes.length} blocks · ${draft.edges.length} connections`;
  });
  executionUI?.draftChanged();
  backtestUI?.sync();
  try{sessionStorage.setItem('poros.orders.market',pairForStrategy(draft).id);}catch{}
  publishChartContext();
  const pairId=pairForStrategy(draft).id;
  if(pricesUI&&pairId!==pricesPairId){pricesPairId=pairId;void pricesUI.refresh();void executionUI.refreshMarket();}
}

function addBlock(type, position) {
  if (!Object.hasOwn(kinds, type)) return;
  if (draft.nodes.length >= 32) { announce("The demo supports up to 32 blocks."); return; }
  const id = crypto.randomUUID();
  const node = type === "signal.price" ? {id, type, minPriceUsd: 2000, maxPriceUsd: 2100} :
    type === "guard.risk" ? {id, type} : {id, type, side: "BUY", notionalUsd: Math.min(20, draft.riskPolicy.maxNotionalUsd)};
  const point = position ?? defaultPosition(draft.nodes.length);
  positions.set(id, {x: Math.max(20, Math.min(canvas.clientWidth - 235, point.x)), y: Math.max(40, Math.min(3000, point.y))});
  selected = id;
  if (edit({type: "addNode", node})) $("#strategy-settings").showModal();
  announce(`${kinds[type].label} added. Connect it into a complete path.`);
}

document.querySelectorAll(".palette-block").forEach(button => {
  button.addEventListener("click", () => addBlock(button.dataset.kind));
  button.addEventListener("dragstart", event => {
    event.dataTransfer.setData("text/plain", JSON.stringify({kind: "palette", type: button.dataset.kind}));
    event.dataTransfer.effectAllowed = "copy";
  });
});
mountCanvasDragTarget(canvas);
canvas.addEventListener("drop", event => {
  event.preventDefault(); canvas.classList.remove("drag-over");
  const member = event.dataTransfer.getData('application/x-poros-member-strategy');
  if (member) { void loadMemberTransfer(member); return; }
  const reference = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
  if (reference && !reference.trimStart().startsWith('{')) { void loadPublicReference(reference); return; }
  try {
    const data = JSON.parse(event.dataTransfer.getData("text/plain")), rect = canvas.getBoundingClientRect();
    if(data.kind === "public-strategy"){void communityUI.load(data.versionKey);return;}
    if(data.kind === "public-post"){void communityUI.loadPost(data.communityKey,data.postKey);return;}
    if (data.kind === "palette") addBlock(data.type, {x: event.clientX - rect.left - 105, y: event.clientY - rect.top - 40});
    else if (data.kind === "move" && positions.has(data.id) && Number.isFinite(data.offsetX) && Number.isFinite(data.offsetY)) moveNode(data.id, event.clientX - rect.left - data.offsetX, event.clientY - rect.top - data.offsetY);
  } catch { announce("Drag a block from the palette onto the canvas."); }
});
$("#strategy-name").addEventListener("change", event => { draft = {...draft, name: event.target.value}; dirty = true; render(); });
$("#max-slippage").addEventListener("change", event => { draft = {...draft, riskPolicy: {...draft.riskPolicy, maxSlippageBps: Number(event.target.value)}}; dirty = true; render(); });
$("#execution-mode").addEventListener("change", () => {draft={...draft,riskPolicy:{...draft.riskPolicy,paperTradingOnly:$("#execution-mode").value!=="LIVE"}};dirty=true;render();});
$("#delete-node").addEventListener("click", () => removeNode(selected));
$("#close-strategy-settings").addEventListener("click", () => $("#strategy-settings").close());
$("#load-example").addEventListener("click", () => { if (mayReplace()) { replaceDraft(defaultStrategy); announce("Price example loaded: buy $20 once between $2000 and $2100."); } });
$("#new-strategy").addEventListener("click", () => { if (mayReplace()) { replaceDraft({...defaultStrategy, strategyId: crypto.randomUUID(), name: "Untitled strategy", description: "Paper strategy draft", nodes: [], edges: []}); announce("Blank canvas ready. Add blocks from the left."); } });
$("#clear-canvas").addEventListener("click", () => {
  replaceDraft({...draft,nodes:[],edges:[]});
  dirty=true;
  announce("Canvas cleared. Add blocks or drop a strategy to start again.");
});
$("#export").addEventListener("click", () => {
  try {
    const text = exportStrategyJson(draft, contextForPair(pairForStrategy(draft)));
    const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
    const link = element("a"); link.href = url; link.download = "strategy.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dirty = false; announce("Validated strategy JSON downloaded. Canvas positions are not included.");
  } catch (error) { announce(error.message); }
});
$("#import").addEventListener("click", () => { $("#import-error").textContent = ""; dialog.showModal(); });
for (const id of ["close-import", "cancel-import"]) $("#" + id).addEventListener("click", () => dialog.close());
$("#json-file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 65536) { $("#import-error").textContent = "JSON file must be at most 64 KiB."; return; }
  try { $("#import-text").value = await file.text(); $("#import-error").textContent = ""; }
  catch { $("#import-error").textContent = "Unable to read this file. Your current draft is unchanged."; }
});
$("#import-form").addEventListener("submit", event => {
  event.preventDefault();
  let result;
  try{const parsed=JSON.parse($("#import-text").value);result=importStrategyJson($("#import-text").value,contextForPair(pairForStrategy(parsed)));}catch{result={valid:false,issues:[{path:"$",message:"Choose a valid strategy with a registered network and pair."}]};}
  if (result.valid) result = validateMarketStrategy(result.strategy);
  if (!result.valid) { $("#import-error").textContent = result.issues.slice(0, 5).map(issue => `${issue.path}: ${issue.message}`).join("\n"); return; }
  if (!result.strategy.riskPolicy.paperTradingOnly) { $("#import-error").textContent = "This demo accepts paper-only strategies. Set paperTradingOnly to true before importing."; return; }
  if (!mayReplace()) return;
  replaceDraft(result.strategy); dialog.close(); announce("Strategy imported and validated. Layout was rebuilt from its blocks.");
});
const ai = mountStrategyAi({
  interpreterOnly:true,
  getDraft: () => draft,
  onKeyChange: () => executionUI?.invalidate("AI key changed. Pending execution was stopped; start a new run when ready."),
  applyDraft(next) {
    if (!validateMarketStrategy(next).valid || !next.riskPolicy.paperTradingOnly) throw new Error("Invalid AI proposal.");
    replaceDraft(next);
    forkSource=undefined;
    dirty = true;
    announce("AI proposal accepted. Export JSON to keep this draft.");
  },
});
executionUI = mountExecution({
  onLoading:setStrategyLoading,
  getPair:()=>pairForStrategy(draft),
  getDraft: () => draft,
  applyDraft(next) {replaceDraft(next); dirty = true;forkSource=undefined;},
  validateDraft: next => validateMarketStrategy(next),
  getApiKey: ai.getKey,
  onText:ai.openText,
  onActivity:event=>{
    if(event.kind==='snapshot')void recordExecutionSnapshot(event.data,event.time).catch(()=>{
      announce('Order history could not be saved in this browser. Trading can continue.');
    });
  },
});
communityUI=mountCommunityLibrary({onLoading:setStrategyLoading,onText:entry=>executionUI.openUnlockedStrategy(entry),onLoad(next,versionKey){
  if(!validateMarketStrategy(next).valid)throw new Error("This public strategy uses unsupported rules or a market outside this live-price builder.");
  replaceDraft(next);dirty=true;forkSource=versionKey;
}});
window.addEventListener("poros:public-data-updated",()=>void communityUI.refresh());
const memberUI=mountMemberLibrary({
  onEntries(entries){executionUI.clearUnlockedStrategies();for(const entry of entries)executionUI.addUnlockedStrategy(entry);},
  onCreators:creators=>executionUI.setFollowedCreators(creators),
  onReset:()=>executionUI.invalidate("Private library locked. Review your draft before starting a new run."),
});
let creatorDirectory;
mountLibraryTabs({onCommunity:()=>communityUI.refresh(),onSelect:tab=>{
  if(tab!=="community")void memberUI.refresh();
  if(tab==="creators"&&!creatorDirectory){
    creatorDirectory=import('../../../../apps/web/src/builder.ts').then(({mountTradeCreators})=>mountTradeCreators($('#trade-creator-directory'))).catch(()=>{creatorDirectory=undefined;$('#trade-creator-directory').textContent='Creators could not load. Select the tab again to retry.';});
  }
}});
window.addEventListener("pagehide",()=>void creatorDirectory?.then(directory=>directory?.dispose()));
window.addEventListener("pagehide",()=>memberUI.stop());
pricesUI=mountLivePrices({
  getPairs:()=>tradingPairs.filter(pair=>pair.network.key===pairForStrategy(draft).network.key).sort((a,b)=>Number(b.id===pairForStrategy(draft).id)-Number(a.id===pairForStrategy(draft).id)),
});
void pricesUI.refresh();
setInterval(()=>{if(!document.hidden)void pricesUI.refresh();},30000);
window.addEventListener("pagehide",()=>pricesUI.stop());
void executionUI.refreshMarket();
setInterval(() => {void executionUI.refreshMarket();}, 10000);
// The host verifies purchase access before calling this demo handoff; this hook is not authorization.
export function loadUnlockedStrategy(entry) {executionUI.addUnlockedStrategy(entry);}
window.addEventListener("strategy:unlocked", event => {
  try {loadUnlockedStrategy(event.detail);} catch (error) {announce(error.message);}
});
// The host supplies creators after verifying membership and follow state.
export function setFollowedCreators(creators) {executionUI.setFollowedCreators(creators);}
window.addEventListener("creators:updated", event => {
  try {setFollowedCreators(event.detail);} catch (error) {announce(error.message);}
});
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
backtestUI=mountBacktest({getDraft:()=>draft,getPair:()=>pairForStrategy(draft),getPairs:()=>tradingPairs,changeMarket(id){if(mayReplace()){replaceDraft(strategyForPair(id,draft),true);dirty=true;}},async loadStrategy(transfer){
  const member=transfer.getData('application/x-poros-member-strategy');
  if(member){const {readMemberStrategy}=await import('../../../../apps/web/src/builder.ts');return executionUI.openUnlockedStrategy(readMemberStrategy(member));}
  const reference=transfer.getData('text/uri-list')||transfer.getData('text/plain');
  if(reference.startsWith(location.origin+'/?strategy=')){const {strategyReference}=await import('../../../../apps/web/src/builder.ts');return communityUI.load(strategyReference(reference,location.origin));}
  const data=JSON.parse(transfer.getData('text/plain'));
  if(data.kind==='public-strategy')return communityUI.load(data.versionKey);
  if(data.kind==='public-post')return communityUI.loadPost(data.communityKey,data.postKey);
  if(data.kind==='unlocked-strategy')return executionUI.openUnlockedReference(data.id);
  throw new Error('Drop a strategy card from Community or Unlocked.');
}});
window.addEventListener('pagehide',()=>backtestUI.stop());
const stopFundsMode = mountFundsMode($("#execution-mode"));
window.addEventListener('pagehide', stopFundsMode, {once:true});
resetPositions(); render();

async function loadMemberTransfer(raw) {
  try {
    const {readMemberStrategy} = await import('../../../../apps/web/src/builder.ts');
    await executionUI.openUnlockedStrategy(readMemberStrategy(raw));
  } catch (error) { announce(error.message || 'Unable to load this member strategy.'); }
}

async function loadPublicReference(reference) {
  try {
    const {strategyReference} = await import('../../../../apps/web/src/builder.ts');
    const transfer=strategyReference(reference,location.origin);
    if(transfer.kind==='public-post')await communityUI.loadPost(transfer.communityKey,transfer.postKey);
    else await communityUI.load(transfer.versionKey);
  } catch (error) { announce(error.message || 'Unable to read the strategy reference.'); }
}

$('#publish-community').addEventListener('click',async()=>{
  try {
    const {builderDocument} = await import('../../../../apps/web/src/builder.ts');
    const document = builderDocument(draft);
    sessionStorage.setItem('poros.public-draft',JSON.stringify({document,...forkSource?{sourceVersionKey:forkSource}:{}}));
    dirty = false;
    location.href = '/community#/publish-draft';
  } catch(error) { announce(error.message || 'Unable to prepare the public draft.'); }
});
if (['strategy','post'].some(key=>new URLSearchParams(location.search).has(key))) void loadPublicReference(location.href);
