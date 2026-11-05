import { validateStrategy } from "/core/validation/strategy.ts";
import { editStrategy, importStrategyJson, exportStrategyJson } from "/core/adapters/editor.ts";
import { fixtureContext, rsiStrategy } from "/core/fixtures/rsi-strategy.ts";
import { keepFocus } from "/focus.js";
import { mountStrategyAi } from "/ai.js";
import { mountExecution } from "/execution.js";

const $ = selector => document.querySelector(selector);
const canvas = $("#canvas");
const dialog = $("#import-dialog");
const kinds = {
  "indicator.rsi": {label: "RSI signal", className: "indicator", icon: "∿"},
  "guard.risk": {label: "Risk limit", className: "guard", icon: "◇"},
  "action.intent": {label: "Buy / sell", className: "action", icon: "⇄"},
};
let draft = structuredClone(rsiStrategy);
let selected = draft.nodes[0]?.id;
let positions = new Map();
let connectFrom;
let dirty = false;
let executionUI;

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
function select(id) { selected = id; $("#strategy-settings").open = true; render(); }
function replaceDraft(next) {
  draft = structuredClone(next);
  selected = draft.nodes[0]?.id;
  connectFrom = undefined;
  resetPositions();
  dirty = false;
  render();
}
function mayReplace() { return !dirty || window.confirm("Replace your current draft? Export JSON first if you want to keep it."); }

function describe(node) {
  if (node.type === "indicator.rsi") return `RSI (${node.period}) ${node.comparison === "lt" ? "<" : ">"} ${node.threshold}`;
  if (node.type === "guard.risk") return `Maximum $${draft.riskPolicy.maxNotionalUsd} per order`;
  return `${node.side === "BUY" ? "Buy" : "Sell"} · $${node.notionalUsd}`;
}

function connect(target) {
  if (!connectFrom) { announce("First choose the right-hand dot on a source block."); return; }
  const source = connectFrom;
  connectFrom = undefined;
  if (edit({type: "connect", edge: {id: crypto.randomUUID(), source, target}})) announce("Connection added. Check validation below the canvas.");
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
      event.preventDefault(); event.stopPropagation();
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        if (data.kind === "connection" && draft.nodes.some(item => item.id === data.id)) { connectFrom = data.id; connect(node.id); }
      } catch { announce("Drag a block's output dot to an input dot."); }
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
    card.append(element("span", "node-number", `${String(index + 1).padStart(2, "0")} / ${node.type === "indicator.rsi" ? "SIGNAL" : node.type === "guard.risk" ? "GUARD" : "ACTION"}`));
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
    card.append(header, element("div", "node-description", describe(node)), element("div", "node-meta", node.type === "indicator.rsi" ? "Check at candle close" : node.type === "guard.risk" ? `${draft.riskPolicy.maxSlippageBps} bps slippage cap · paper only` : "Creates an intention, not a trade"));
    if (node.type !== "indicator.rsi") card.append(port(node, "input"), element("span", "port-label left", "IN"));
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
  $("#max-notional").value = draft.riskPolicy.maxNotionalUsd;
  $("#max-slippage").value = draft.riskPolicy.maxSlippageBps;
  const node = draft.nodes.find(item => item.id === selected);
  const panel = $("#node-settings");
  panel.replaceChildren();
  $("#delete-node").hidden = !node;
  $("#selected-kind").textContent = node ? kinds[node.type].label : "None";
  if (!node) { panel.append(element("p", "small muted", "Select a block to edit its settings.")); return; }
  const update = settings => edit({type: "updateNode", nodeId: node.id, settings});
  if (node.type === "indicator.rsi") {
    panel.append(field("RSI period", node.period, {type: "number", min: 2, max: 200, step: 1}, value => update({period: value})),
      field("Condition", node.comparison, {options: [["lt", "Is below (<)"], ["gt", "Is above (>)"]]}, value => update({comparison: value})),
      field("RSI threshold", node.threshold, {type: "number", min: 0, max: 100, step: "any"}, value => update({threshold: value})));
  } else if (node.type === "action.intent") {
    panel.append(field("Action", node.side, {options: [["BUY", "Buy base asset"], ["SELL", "Sell base asset"]]}, value => update({side: value})),
      field("Order size (USD)", node.notionalUsd, {type: "number", min: 0.01, step: 0.01}, value => update({notionalUsd: value})));
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
  $("#validation").classList.toggle("needs-fixes", !result.valid);
  $("#validation-icon").textContent = result.valid ? "✓" : "!";
  $("#validation-title").textContent = result.valid ? "Strategy is valid" : `${result.issues.length} ${result.issues.length === 1 ? "thing" : "things"} to fix`;
  $("#validation-description").textContent = result.valid ? "All paths have a signal, risk guard, and action. Ready to export." : "Connect complete paths and check the highlighted settings before exporting.";
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
  $("#export").title = result.valid ? "Save validated strategy JSON" : "Fix validation errors before exporting";
}

function render() {
  keepFocus(document, () => {
    const result = validateStrategy(draft, fixtureContext);
    renderNodes(result); renderSettings(); renderConnections(); renderValidation(result);
    $("#block-count").textContent = `${draft.nodes.length} blocks · ${draft.edges.length} connections`;
    $("#json-preview").textContent = JSON.stringify(draft, null, 2);
  });
  executionUI?.draftChanged();
}

function addBlock(type, position) {
  if (!Object.hasOwn(kinds, type)) return;
  if (draft.nodes.length >= 32) { announce("The demo supports up to 32 blocks."); return; }
  const id = crypto.randomUUID();
  const node = type === "indicator.rsi" ? {id, type, period: 14, comparison: "lt", threshold: 30} :
    type === "guard.risk" ? {id, type} : {id, type, side: "BUY", notionalUsd: Math.min(20, draft.riskPolicy.maxNotionalUsd)};
  const point = position ?? defaultPosition(draft.nodes.length);
  positions.set(id, {x: Math.max(20, Math.min(canvas.clientWidth - 235, point.x)), y: Math.max(40, Math.min(3000, point.y))});
  selected = id;
  $("#strategy-settings").open = true;
  edit({type: "addNode", node});
  announce(`${kinds[type].label} added. Connect it into a complete path.`);
}

document.querySelectorAll(".palette-block").forEach(button => {
  button.addEventListener("click", () => addBlock(button.dataset.kind));
  button.addEventListener("dragstart", event => {
    event.dataTransfer.setData("text/plain", JSON.stringify({kind: "palette", type: button.dataset.kind}));
    event.dataTransfer.effectAllowed = "copy";
  });
});
canvas.addEventListener("dragover", event => { event.preventDefault(); canvas.classList.add("drag-over"); });
canvas.addEventListener("dragleave", event => { if (!canvas.contains(event.relatedTarget)) canvas.classList.remove("drag-over"); });
canvas.addEventListener("drop", event => {
  event.preventDefault(); canvas.classList.remove("drag-over");
  try {
    const data = JSON.parse(event.dataTransfer.getData("text/plain")), rect = canvas.getBoundingClientRect();
    if (data.kind === "palette") addBlock(data.type, {x: event.clientX - rect.left - 105, y: event.clientY - rect.top - 40});
    else if (data.kind === "move" && positions.has(data.id) && Number.isFinite(data.offsetX) && Number.isFinite(data.offsetY)) moveNode(data.id, event.clientX - rect.left - data.offsetX, event.clientY - rect.top - data.offsetY);
  } catch { announce("Drag a block from the palette onto the canvas."); }
});
$("#strategy-name").addEventListener("change", event => { draft = {...draft, name: event.target.value}; dirty = true; render(); });
for (const [selector, key] of [["#max-notional", "maxNotionalUsd"], ["#max-slippage", "maxSlippageBps"]]) {
  $(selector).addEventListener("change", event => { draft = {...draft, riskPolicy: {...draft.riskPolicy, [key]: Number(event.target.value)}}; dirty = true; render(); });
}
$("#delete-node").addEventListener("click", () => removeNode(selected));
$("#validate").addEventListener("click", () => { const result = validateStrategy(draft, fixtureContext); renderValidation(result); announce(result.valid ? "Validation passed. This checks rules, not trading performance." : `Validation found ${result.issues.length} issues. Review the list below the canvas.`); });
$("#load-example").addEventListener("click", () => { if (mayReplace()) { replaceDraft(rsiStrategy); announce("RSI example loaded: buy below 30, sell above 70, $20 per order."); } });
$("#new-strategy").addEventListener("click", () => { if (mayReplace()) { replaceDraft({...rsiStrategy, strategyId: crypto.randomUUID(), name: "Untitled strategy", description: "Paper strategy draft", nodes: [], edges: []}); announce("Blank canvas ready. Add blocks from the left."); } });
for (const view of ["canvas", "json"]) $("#" + view + "-view").addEventListener("click", () => {
  $("#canvas-viewport").hidden = view !== "canvas"; $("#json-panel").hidden = view !== "json";
  for (const name of ["canvas", "json"]) { $("#" + name + "-view").classList.toggle("active", view === name); $("#" + name + "-view").setAttribute("aria-pressed", String(view === name)); }
});
$("#export").addEventListener("click", () => {
  try {
    const text = exportStrategyJson(draft, fixtureContext);
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
  const result = importStrategyJson($("#import-text").value, fixtureContext);
  if (!result.valid) { $("#import-error").textContent = result.issues.slice(0, 5).map(issue => `${issue.path}: ${issue.message}`).join("\n"); return; }
  if (!result.strategy.riskPolicy.paperTradingOnly) { $("#import-error").textContent = "This demo accepts paper-only strategies. Set paperTradingOnly to true before importing."; return; }
  if (!mayReplace()) return;
  replaceDraft(result.strategy); dialog.close(); announce("Strategy imported and validated. Layout was rebuilt from its blocks.");
});
const ai = mountStrategyAi({
  getDraft: () => draft,
  onKeyChange: () => executionUI?.invalidate("AI key changed. Pending execution was stopped; start a new run when ready."),
  applyDraft(next) {
    if (!validateStrategy(next, fixtureContext).valid || !next.riskPolicy.paperTradingOnly) throw new Error("Invalid AI proposal.");
    replaceDraft(next);
    dirty = true;
    announce("AI proposal accepted. Export JSON to keep this draft.");
  },
});
executionUI = mountExecution({
  getDraft: () => draft,
  mayReplace,
  applyDraft(next) {replaceDraft(next); dirty = true;},
  validateDraft: next => validateStrategy(next, fixtureContext),
  getApiKey: ai.getKey,
});
executionUI.addUnlockedStrategy({strategy: rsiStrategy, versionId: "public-demo-v1"});
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
resetPositions(); render();
