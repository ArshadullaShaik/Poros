# How Poros uses Arkiv

Arkiv supplies the records shown in Home, Communities, creator profiles, membership views, and verified trade reports.

## From publication to fork

1. Validate the builder graph, envelope, and content hash.
2. Ask the author's wallet to publish a version on Rabdi, then read it back.
3. Attach its exact version key to a community discussion.
4. Retrieve and validate that version when opening it on the canvas.
5. Publish a revision or fork with its parent/source reference preserved.

Importing a strategy creates a draft; it never places a trade.

| User action | Arkiv reads | Visible result |
|---|---|---|
| Discover strategies | Versions filtered by roots, community, category, chain, or name where requested | Live public ideas rather than bundled samples. |
| Read a room | Community/posts and scoped social events | Room-specific discussion and policy. |
| Find a creator | Current wallet-linked profile events | Names aid discovery; wallets remain identity. |
| Check membership | Plans and direct/relayed claims, followed by payment verification | Access and counts derived from evidence. |
| Open private content | Publication pointers and membership evidence | Backend delivers only eligible member content. |
| Inspect trading history | Ledger records from the configured trusted writer | Verifier-backed fills remain separate from paper results. |

## Membership and private delivery

New plans charge Rabdi tGLM for 30 days. The buyer pays the creator directly; transaction data binds the plan and request. After two confirmations, a worker verifies payment and records activation. Recovery uses the original payment. Legacy Sepolia claims retain their own path.

The creator signs the exact private publication. The backend uploads encrypted content to Bee, reads it back, and writes an Arkiv pointer through the relay. Full secret references stay in encrypted backend custody. Delivery checks eligibility both now and at publication time; a later subscriber does not receive the earlier archive.

The relay owns relay-written entities. The creator's signature is checked separately. Free joining does not grant paid access, and signing a read is not another payment. Received plaintext cannot be revoked.

## Storage features users see

| Feature | Effect |
|---|---|
| Native creator/owner | Authorship checks and owner-checked community edits. |
| Readonly payloads | Revisions append new records instead of overwriting published rules. |
| Typed indexes | Queries narrow by room, creator, event, strategy relationship, or trader. |
| Expiration | Availability is bounded; missing dependencies remain explicit. |
| Extension flags | New communities can be extended without granting editing rights. |
| Keys and hashes | Posts reference exact versions; imports check integrity. |
| Public reads | Other clients can inspect the same public history. |

Business rules such as payment validity, member eligibility, and verifier trust remain application logic.

## Implementation and proof

| Area | Code |
|---|---|
| SDK writes and strategy validation | [Client](../src/integrations/arkiv/client.ts), [service](../src/integrations/arkiv/service.ts) |
| Social events | [Repository](../src/integrations/arkiv/community/repository.ts), [validation](../src/integrations/arkiv/community/events.ts) |
| Membership eligibility | [Memberships](../src/integrations/arkiv/community/memberships.ts) |
| Private publication | [Relay](../src/features/builder/server/membership-relay.ts), [content backend](../src/features/builder/server/member-content.ts) |
| Trade evidence | [Trade repository](../src/integrations/arkiv/trades.ts) |

[Local verification](../apps/web/VERIFICATION.md) passed 506 tests and the production build, with one live-wallet test skipped. The [README query](../README.md#verify-the-public-data) independently reads real Rabdi records. A relayed publication was observed; its presence alone does not prove private delivery.

Public reads are deduplicated and rate-limited; discovery caches are separate from access checks. Failed live requests do not silently become preview data.

[Schema and retention](schema.md) · [Track criteria](https://ethglobal.com/events/mumbai/prizes/arkiv)
