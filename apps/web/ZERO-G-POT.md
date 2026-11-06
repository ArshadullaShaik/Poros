# 0G Pot integration status

The `/0g-pot` page is an interactive mock demo. It starts with 30 donated credits, 10 claimed, 20 available, and a 1.271-credit demo allowance. Donate moves simulated allowance into the pool; “Simulate used-up allowance” enables testing claims. The demo allows one claim of at most 1.2771 credits per UTC day after allowance exhaustion. All amounts use integer ten-thousandths of a credit.

State is in memory for one demo user, resets on page reload, and refreshes for a new UTC day on the next render or action. No real balance reads, signatures, transfers, or inference calls occur. The UI explicitly labels the mock data and reset behavior. The live-integration notes below remain future requirements, not implemented capabilities.

## Product rules

- Donate unused daily iAI staking compute credits.
- Claim at most 1.2771 credits once per person per UTC day, only after their own allowance is exhausted.
- Reset the claim limit at 00:00 UTC. Do not extend donated credits' original expiry.
- Show verified totals, available credits and claimed credits.

## Verified documentation (6 November 2026)

[0G's iAI announcement](https://0g.ai/blog/introducing-infinite-ai) describes daily credits expiring at 00:00 UTC. Its published allocation is 1.271 per staked iAI; the requested Poros claim cap remains 1.2771.

[Partner Regrant API](https://pay.staging.0g.ai/docs/partner-regrant) documents partner-to-recipient redistribution. 0G supplies an approved signer, an unpublished API host, a source credit lot and its scope/expiry. The server calls `POST /v1/regrants`. Amounts are integer micro-USD. The signer signs `pay-v2|POST|/v1/regrants|<timestamp>|<sha256 of exact body bytes>` using EIP-191. Stable `external_ref` values prevent duplicate payments; inspect each row's outcome. Recipients cannot receive a later expiry or broader scope than the source lot. The public docs provide no endpoint for partners to list their lots.

[Operator onboarding](https://pay.staging.0g.ai/docs/partner-regrant/operator) requires 0G to approve the partner address and grant its source lot. This does not establish permission to debit ordinary users' iAI allowances.

## Still required before implementing transfers

Obtain the partner kit and the documented, user-authorized iAI donation API; an authoritative allowance/expiry read for claim eligibility; the conversion between iAI compute credits and Pay micro-USD; and the account identity used to enforce one claim per person. A wallet alone does not establish a unique person.

Keep the signer key server-side. Enforce daily claims durably on the server, with stable retry references. Neither browser storage nor an inference HTTP 402 proves that a user's daily iAI allowance is exhausted. Do not substitute token deposits or partner-funded grants for user donations.
