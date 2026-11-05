export function mountStrategyAi({root = document, getDraft, applyDraft, request = fetch, onKeyChange}) {
  const $ = id => root.querySelector(`#${id}`);
  let apiKey = "", busy = false, pending, snapshot, controller, sequence = 0;
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
    $("ai-run").textContent = busy ? "Asking 0G…" : "Ask AI";
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
    if (!/^sk-[A-Za-z0-9_-]{8,240}$/.test(entered)) {
      $("ai-key-status").textContent = "Use an inference key starting with sk-. Management keys are not accepted.";
      return;
    }
    apiKey = entered;
    onKeyChange?.();
    discard();
    $("ai-key-status").textContent = "Key ready for this tab. 0G checks it when you ask AI.";
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
    discard();
    status("Key cleared from this tab. An already accepted request may still be charged by 0G.");
    refresh();
  });
  $("ai-operation").addEventListener("change", refresh);
  $("ai-discard").addEventListener("click", () => { discard(); status("Proposal discarded. Your draft is unchanged."); });
  $("ai-accept").addEventListener("click", () => {
    if (!pending) return;
    if (JSON.stringify(getDraft()) !== snapshot) {
      discard(); status("Your draft changed. Ask AI again before applying a proposal."); return;
    }
    try {
      applyDraft(pending);
      discard(); status("AI proposal accepted as your editable paper draft.");
    } catch { discard(); status("The proposal could not be applied. Your draft is unchanged."); }
  });
  $("ai-form").addEventListener("submit", async event => {
    event.preventDefault();
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
    status("Asking the lowest estimated-cost compatible model. Your current draft stays editable.");
    try {
      const response = await request("/api/ai", {method: "POST", signal, headers: {"Content-Type": "application/json", Authorization: `Bearer ${apiKey}`}, body: JSON.stringify(input)});
      const result = await response.json();
      if (current !== sequence) return;
      if (!response.ok || !result.ok) { status(result.error?.message ?? "AI is unavailable. Your draft is unchanged."); return; }
      if (JSON.stringify(getDraft()) !== snapshot) { status("Your draft changed during the request. Ask AI again to get a current proposal."); return; }
      const data = result.data;
      pending = data.proposedDraft;
      $("ai-explanation").textContent = [data.explanation, ...data.changeSummary.map(item => `• ${item}`), ...data.warnings.map(item => `Warning: ${item}`)].join("\n");
      const metadata = data.inferenceMetadata;
      $("ai-metadata").textContent = `0G · ${metadata.model}${metadata.totalCostNeuron !== undefined ? ` · Charged: ${metadata.totalCostNeuron} neuron` : " · Cost not reported"}${metadata.requestId ? ` · Request: ${metadata.requestId}` : ""}`;
      $("ai-draft").textContent = pending ? JSON.stringify(pending, null, 2) : "";
      $("ai-draft").hidden = !pending;
      $("ai-accept").hidden = !pending;
      $("ai-result").hidden = false;
      status(pending ? "Review the proposal below. Accept it to replace your current draft." : "Explanation ready. Your draft is unchanged.");
    } catch {
      if (current === sequence) status("The AI request could not finish. Check 0G usage before trying again; it may have been charged.");
    } finally {
      if (current === sequence) {busy = false; controller = undefined; refresh();}
    }
  });
  discard(); refresh();
  return {getKey: () => apiKey};
}
