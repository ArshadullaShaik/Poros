# How Poros uses Arkiv

Poros uses Arkiv Rabdi to give trading communities a shared strategy history. Wallet-authored versions and revision links let members inspect retained calls beyond a creator's current feed. Arkiv also stores community activity, creator memberships, and trade records.

## What users see

| Feature | Arkiv integration |
|---|---|
| Strategy discovery | Query versions by community, category, name, or chain. |
| Canvas imports and forks | Load an exact version; preserve its author and parent/source reference. |
| Communities and profiles | Read room discussions and wallet-linked profiles. |
| Creator memberships | Store plans and verified payment claims used to determine paid access. |
| Exclusive posts | Store publication pointers; encrypted content lives on Swarm/Bee. |
| Trade history | Read execution records from the configured trusted writer. |

## Writes, ownership, and lifetime

- **Publishing:** validate the strategy, request a wallet-signed write, then read the saved version. Revisions and forks create new records.
- **Permissions:** check native creator/owner metadata and application signatures. Relay publications also require the creator's authorization.
- **Queries:** filter indexed attributes by record type, community, creator, or strategy relationship; paginate by entity key.
- **Expiration:** strategy and social records normally last 180 days; chat lasts 45 days. Communities support custom durations and extensions; the trade worker renews its records.

Free community joining and paid membership are separate. Importing a strategy creates a draft; execution requires separate authorization.

## Implementation

[Strategy storage](../src/integrations/arkiv/client.ts) · [Social queries](../src/integrations/arkiv/community/repository.ts) · [Memberships](../src/integrations/arkiv/community/memberships.ts) · [Trade records](../src/integrations/arkiv/trades.ts)

[Full schema](schema.md) · [Runnable public query](../README.md#verify-the-public-data)
