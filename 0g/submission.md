# Poros — 0G

**Track:** Build with 0G Private Computer

**Status:** inference integration implemented; live request evidence and submission assets pending.

[Live app](https://poros-theta.vercel.app/) · [Repository](https://github.com/ArshadullaShaik/Poros) · [Setup](../README.md#run-locally) · [Requirements](https://ethglobal.com/events/mumbai/prizes/0g)

## What users do

Bring a written community strategy, interpret it through 0G, and review the validated price/risk/action graph. Ambiguity produces questions rather than invented rules. Users return to evaluate new ideas and revisions.

**Without 0G, written strategies cannot be automatically interpreted into reviewed canvas rules; manual building remains available.**

Interpretation never places a trade. The interpreter supports registered markets, inclusive USD price ranges or explicit market-price behavior, and explicit amounts within the current $20 order cap.

## Integration

| Detail | Implementation |
|---|---|
| Catalog | `GET https://router-api.0g.ai/v1/models` |
| Inference | `POST https://router-api.0g.ai/v1/chat/completions` |
| Model selection | Lowest estimated-cost eligible `qwen3.7-flash` or `qwen-flash`; requires pricing, a provider, text I/O, OpenAI format, tool support, and sufficient context. |
| Cost controls | Catalog-derived price caps, price-based provider choice, disabled fallback, and 2,048 maximum output tokens. Estimates are not exact bills. |
| Evidence | Returned model and latency; optional `x_0g_trace.request_id`, provider, and billing metadata. Missing IDs stay missing. |
| Failures | Reject malformed output/model mismatches; report authentication, balance, rate-limit, and provider errors. A 30-second timeout does not trigger an automatic paid retry. |

The key is stored in the browser when available and sent to the backend for the requested inference. Same-origin scripts can read it: use a dedicated key and Forget key when finished. Do not publish raw network exports or authorization headers. We do not claim independently verified confidential-execution proofs.

| Area | Source and tests |
|---|---|
| Catalog, inference, and metadata | [0G client](../src/features/builder/ai/zero-g.ts), [AI tests](../tests/dev3/ai.test.ts) |
| Text to graph | [Interpreter](../src/features/builder/ai/interpreter.ts), [flow tests](../tests/dev3/text-live-flow.test.ts) |
| Review and clarification | [Interface](../src/features/builder/demo/ai.js), [UI tests](../tests/dev3/ai-ui.test.ts) |
| API | [Handler](../src/features/builder/server/api.mjs), [route tests](../tests/dev3/ai-route.test.ts) |

## Evidence to attach

| Item | Status |
|---|---|
| Project | **Poros:** social strategy creation with AI interpretation and user review. |
| Public code, setup, live app | Linked above. |
| Successful real request ID | **Pending.** Reuse an existing authorized run if available; never use a fixture ID. |
| Corresponding model and run context | **Pending.** Include time, input, and reviewed result. |
| Video under three minutes | **Pending.** Use 2–under-3 minutes to also fit ETHGlobal's video length. |
| Team names and Telegram/X contacts | **Pending approved public details.** |
| Contract addresses | Not applicable to this inference path; list verified addresses if the team submits other deployed contracts. |

Show interpretation, the real request ID/model, and canvas review. Definitive's advanced-order work is not required to demonstrate this flow. Tests validate controlled responses, not a successful paid deployment run.

The [0G Pot](../apps/web/ZERO-G-POT.md) is a mock. This submission does not claim iAI sign-in, real credit deductions, or autonomous revenue-to-compute funding.
