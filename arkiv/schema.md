# Arkiv schema

Network: **Rabdi, 7794095**. SDK: **`@arkiv-network/sdk` 1.0.1**. [Run a public query](../README.md#verify-the-public-data).

## Entities and indexes

| Namespace | Purpose | Indexed application fields | Ownership and lifetime |
|---|---|---|---|
| `ethmumbai.strategyhub.v1.versions` | Validated versions, revisions, forks | `strategyId`, `requestId`, `isRoot`, `rootVersion`, `parentVersion`, `forkSource`, `community`, `nameSearch`, `category`, `executionChainId`, `contentHash` | Publishing wallet; readonly payload; 180 days. |
| `ethmumbai.strategyhub.v1.communities` | Room identity and description | `requestId`, `nameSearch` | Creating wallet; owner-only content edits; 180-day default with duration overrides. |
| `ethmumbai.strategyhub.v1.posts` | Discussion linked to an optional version | `requestId`, `community`, `strategyVersion` | Posting wallet; readonly payload; 180 days. |
| `ethmumbai.social.v1.events` | Profile, discussion, policy, membership events | `eventType`, `subject`, `scope`, `requestId` | User or relay wallet; readonly payload; 180 days except `message` at 45 days. |
| `ethmumbai.trades.v1` | Execution/source evidence | `recordKind`, `trader`, `source`, `identity` | Configured trusted writer; readonly payload; 180 days, renewed by its worker below 30 days remaining. |

Canonical bytes live in `record`; attributes are checked against decoded content. Native metadata supplies creator, owner, creation/expiration blocks, and flags. Queries use `arkiv.schema`, `$creator`, and `$key`, with key pagination and strategy name-prefix search where requested. Not every index has a UI filter. `$createdAt` must be filtered locally.

Sources: [schemas](../src/integrations/arkiv/schema.ts), [client](../src/integrations/arkiv/client.ts), [social repository](../src/integrations/arkiv/community/repository.ts), [trades](../src/integrations/arkiv/trades.ts).

## Social relationships

| Events | Meaning and authority |
|---|---|
| `profile` | Global wallet identity and handle; actor must match native creator/owner. |
| `membership` | Free community join/leave state; never paid access. |
| `thread`, `reply`, `message`, `vote` | Community-scoped activity with authorship and policy checks. |
| `ban`, `hidden`, `moderator` | Policy/history events; authorized actor checked. Includes legacy formats, not necessarily manual UI controls. |
| `creator-plan` | Price/terms revisions; actor and subject are creator, scope is global. |
| `subscription` | Direct claim: actor is buyer, subject is creator; payment must verify. |
| `subscription-relay` | Worker activation: subject is buyer, scope is creator; bound payment evidence must verify. |
| `private-signal-relay` | Relay-written publication with creator authorization and Swarm pointer; subject is creator. |
| `encryption-key`, `private-signal`, `signal-envelope` | Earlier encryption and direct delivery formats, with legacy checks. |
| `listing`, `delisted` | Seller-controlled listing support; not a claim of completed standalone strategy checkout. |

See [contracts](../src/integrations/arkiv/community/contracts.ts), [event validation](../src/integrations/arkiv/community/events.ts), and [membership logic](../src/integrations/arkiv/community/memberships.ts).

## Permissions and expiration

- Native ownership/flags and application authorization are separate. A familiar schema tag alone does not make a record trusted.
- New communities allow permissionless **extension**, not editing. Other new strategy/social records disallow permissionless extension; historical flags are preserved.
- Revisions append records. Readonly payloads do not guarantee permanent existence.
- Storage lifetime and the 30-day paid term are separate. Private delivery requires eligibility now and at publication time; new subscribers do not receive backlog.
- Expiration is a block boundary. Day values use SDK conversion; community requests at or above 182 days use the SDK maximum, not unlimited retention.
- Expired sources, plans, or claims may leave incomplete history. Social scans fail above 500 live records; trade reports fail above 10,000 rather than truncate.

## Private content

The pointer has `format`, `publicationId`, `swarmAddress`, `payloadHash`, and `source`. Only the Swarm address is public. The full reference contains decryption material and stays in encrypted backend custody. Bodies and private strategy JSON remain on Swarm.

Hashes provide integrity, not secrecy for predictable text. SQLite jobs/custody, browser drafts, credentials, and market feeds are outside this schema.

[Pointer format](../src/integrations/arkiv/community/member-content.ts) · [Content backend](../src/features/builder/server/member-content.ts) · [Track requirements](https://ethglobal.com/events/mumbai/prizes/arkiv)
