# 0G Pot: mock only

`/0g-pot` simulates one user's credit pool in memory. It performs no real balance reads, signatures, transfers, or inference.

| Demo behavior | Value |
|---|---|
| Initial donated / claimed / available | 30 / 10 / 20 credits |
| Initial allowance | 1.271 credits |
| Claim cap | 1.2771 credits, once per UTC day after simulated allowance exhaustion |
| Precision | Integer ten-thousandths of a credit |
| Reset | Page reload; UTC-day refresh on the next render/action |

Donate moves simulated allowance into the pool. The UI labels mock data and reset behavior.

## Before implementing real transfers

The [iAI announcement](https://0g.ai/blog/introducing-infinite-ai) describes 1.271 daily credits per staked iAI, expiring at 00:00 UTC. Poros's requested 1.2771 claim cap is a separate demo rule.

The [Partner Regrant API](https://pay.staging.0g.ai/docs/partner-regrant) supports approved partner-to-recipient grants. It does not establish permission to debit ordinary users' allowances. Its documented flow uses an approved signer/host/source lot, integer micro-USD, signed `POST /v1/regrants`, and stable `external_ref` values. Recipient scope and expiry cannot exceed the source lot. [Operator onboarding](https://pay.staging.0g.ai/docs/partner-regrant/operator) is required.

Still needed:

- A documented user-authorized donation API and authoritative allowance/expiry reads.
- Conversion between compute credits and Pay micro-USD.
- An identity scheme for one claim per person; a wallet alone is insufficient.
- Server-side durable claims, protected signing keys, and idempotent retries.

Browser state or inference HTTP 402 cannot prove allowance exhaustion. Do not present token deposits or partner-funded grants as user donations, or this mock as evidence for an iAI/self-funding prize.
