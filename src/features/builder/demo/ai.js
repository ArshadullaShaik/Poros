export function mountStrategyAi({root = document, getDraft, applyDraft, request = fetch, onKeyChange, interpreterOnly = false}) {
  const $ = id => root.querySelector(`#${id}`);
  let apiKey = "", busy = false, pending, snapshot, controller, sequence = 0, textName = "Interpreted creator strategy";
  const storageKey = "poros.0g-inference-key";
  const validKey = key => typeof key === "string" && /^sk-[A-Za-z0-9_-]{8,240}$/.test(key);
  try {
    const saved = root.defaultView.localStorage.getItem(storageKey);
    if (validKey(saved)) {
      apiKey = saved;
      $("ai-key-status").textContent = "Saved key restored from this browser. 0G checks it when you ask AI.";
    }
  } catch { /* The key can still be used in memory when browser storage is blocked. */ }

  const status = message => { $("ai-status").textContent = message; };
  $("ai-open").addEventListener("click", () => $("ai-dialog").showModal());
  $("ai-close").addEventListener("click", () => $("ai-dialog").close());
  $("ai-dialog").addEventListener("close", () => { $("ai-key").value = ""; });
  function refresh() {
    $("ai-run").disabled = !apiKey || busy;
    $("ai-use-key").disabled = busy;
    $("ai-operation").disabled = busy;
    $("ai-prompt").disabled = busy || $("ai-operation").value === "explain";
    $("ai-forget").disabled = !apiKey;
    $("ai-run").textContent = busy ? "Interpreting…" : (interpreterOnly ? "Interpret creator text" : "Ask AI");
    if ($("ai-key")) {
      $("ai-key").placeholder = apiKey ? `sk-••••••••${apiKey.slice(-4)} (Key active)` : "sk-…";
      $("ai-key").title = apiKey ? `Active key: sk-...${apiKey.slice(-4)}` : "0G inference API key";
    }
    if ($("ai-use-key")) {
      $("ai-use-key").textContent = apiKey ? "Update key" : "Use key";
    }
  }
  function discard() {
    pending = undefined;
    $("ai-result").hidden = true;
    $("ai-draft").textContent = "";
    $("ai-explanation").textContent = "";
    $("ai-metadata").textContent = "";
  }
  $("ai-key-form").addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    const entered = $("ai-key").value.trim();
    $("ai-key").value = "";
    if (!validKey(entered)) {
      $("ai-key-status").textContent = "Use an inference key starting with sk-. Management keys are not accepted.";
      return;
    }
    apiKey = entered;
    onKeyChange?.();
    discard();
    try {
      root.defaultView.localStorage.setItem(storageKey, apiKey);
      $("ai-key-status").textContent = "Key saved in this browser until you forget it. 0G checks it when you ask AI.";
    } catch {
      $("ai-key-status").textContent = "Key ready for this tab, but not saved: browser storage is unavailable.";
    }
    status("Choose an action and ask AI. Each request can spend your 0G balance.");
    refresh();
  });
  $("ai-forget").addEventListener("click", () => {
    sequence++;
    controller?.abort();
    controller = undefined;
    apiKey = ""; busy = false;
    onKeyChange?.();
    $("ai-key").value = "";
    $("ai-key-status").textContent = "Key forgotten. Enter it again to use AI.";
    let removalFailed = false;
    try { root.defaultView.localStorage.removeItem(storageKey); }
    catch {
      removalFailed = true;
      $("ai-key-status").textContent = "Key cleared from memory, but could not remove the saved key. Retry Forget key or clear this site's browser data.";
    }
    discard();
    status("Key cleared from this tab. An already accepted request may still be charged by 0G.");
    refresh();
    if (removalFailed) $("ai-forget").disabled = false;
  });
  $("ai-operation").addEventListener("change", refresh);
  $("ai-discard").addEventListener("click", () => { discard(); status("Proposal discarded. Your draft is unchanged."); });
  function loadProposal() {
    if (!pending) return;
    if (JSON.stringify(getDraft()) !== snapshot) {
      discard(); status("Your draft changed. Ask AI again before applying a proposal."); return;
    }
    try {
      applyDraft(pending);
      discard(); status("Interpreted rules loaded. Review them before Run.");
      return true;
    } catch { discard(); status("The proposal could not be applied. Your draft is unchanged."); }
  }
  $("ai-accept").addEventListener("click", loadProposal);
  $("ai-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!apiKey && $("ai-key")) {
      const entered = $("ai-key").value.trim();
      if (validKey(entered)) {
        apiKey = entered;
        $("ai-key").value = "";
        onKeyChange?.();
        try {
          root.defaultView.localStorage.setItem(storageKey, apiKey);
          $("ai-key-status").textContent = "Key saved in this browser until you forget it. 0G checks it when you ask AI.";
        } catch {
          $("ai-key-status").textContent = "Key ready for this tab, but not saved: browser storage is unavailable.";
        }
        refresh();
      }
    }
    if (!apiKey || busy) return;
    const operation = $("ai-operation").value;
    const prompt = $("ai-prompt").value.trim();
    if (operation !== "explain" && (!prompt || prompt.length > 4000)) { status("Enter an instruction of at most 4,000 characters."); return; }
    snapshot = JSON.stringify(getDraft());
    const input = {operation, ...(operation !== "explain" ? {prompt} : {}), ...(operation !== "generate" ? {strategy: JSON.parse(snapshot)} : {})};
    const current = ++sequence;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]);
    busy = true; discard(); refresh();
    status("Asking the lowest estimated-cost compatible Qwen model. Your current draft stays editable.");
    try {
      const response = await request(interpreterOnly ? "/api/interpret" : "/api/ai", {method: "POST", signal, headers: {"Content-Type": "application/json", Authorization: `Bearer ${apiKey}`}, body: JSON.stringify(interpreterOnly ? {name:textName,text:prompt} : input)});
      const result = await response.json();
      if (current !== sequence) return;
      if (!response.ok || !result.ok) { status(result.error?.message ?? "AI is unavailable. Your draft is unchanged."); return; }
      if (JSON.stringify(getDraft()) !== snapshot) { status("Your draft changed during the request. Ask AI again to get a current proposal."); return; }
      const data = interpreterOnly ? {...result.data,proposedDraft:result.data.strategy,explanation:result.data.status === "READY" ? "Creator text interpreted. Review the price ranges and amounts before Run." : "Creator instructions need clarification.",changeSummary:[],warnings:result.data.questions??[]} : result.data;
      pending = interpreterOnly && result.data.status !== "READY" ? undefined : data.proposedDraft;
      if (interpreterOnly && pending) {
        if (loadProposal()) $("ai-dialog").close();
        return;
      }
      $("ai-explanation").textContent = [data.explanation, ...data.changeSummary.map(item => `• ${item}`), ...data.warnings.map(item => `Warning: ${item}`)].join("\n");
      const metadata = data.inferenceMetadata;
      $("ai-metadata").textContent = `0G · ${metadata.model}${metadata.totalCostNeuron !== undefined ? ` · Charged: ${metadata.totalCostNeuron} neuron` : " · Cost not reported"}${metadata.requestId ? ` · Request: ${metadata.requestId}` : ""}`;
      $("ai-draft").textContent = pending ? JSON.stringify(pending, null, 2) : "";
      $("ai-draft").hidden = !pending;
      $("ai-accept").hidden = !pending;
      $("ai-result").hidden = false;
      status(pending ? "Review the proposal below. Accept it to replace your current draft." : interpreterOnly ? "Complete the missing details in the instructions above, then interpret again." : "Explanation ready. Your draft is unchanged.");
    } catch {
      if (current === sequence) status("The AI request could not finish. Check 0G usage before trying again; it may have been charged.");
    } finally {
      if (current === sequence) {busy = false; controller = undefined; refresh();}
    }
  });
  discard(); refresh();
  return {getKey: () => apiKey,openText(entry) {
    if(busy)throw new Error('An interpretation is already running. Finish it before loading another post.');
    if(typeof entry?.name!=='string'||!entry.name.trim()||entry.name.length>100||typeof entry.text!=='string'||!entry.text.trim()||entry.text.length>4000)throw new Error('Load a named strategy with at most 4,000 characters of instructions.');
    discard();textName=entry.name;$("ai-operation").value="generate";$("ai-prompt").value=entry.text;
    $("ai-interpreter").open=true;
    status(apiKey?'Review the instructions, including trade size and network, then interpret to load the rules. Each request uses your 0G balance.':'Add your 0G inference key above, then interpret these instructions to load the rules onto your canvas.');
    refresh();$("ai-dialog").showModal();
    if(apiKey){try{($("ai-run")||$("ai-prompt"))?.focus();}catch{}}
  }};
}
