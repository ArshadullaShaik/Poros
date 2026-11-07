# Why Arkiv

On chat and social platforms, a trader can share a strategy, delete it when it fails, and leave only successful calls visible. People considering that trader's advice or membership then see an incomplete history.

Poros uses Arkiv to publish wallet-authored strategy versions with links to their revisions and forks. Community members can inspect the published rules and query retained records independently of the creator's feed or the Poros website.

This gives communities a shared history to evaluate before trusting a creator. Strategy records default to 180 days; Arkiv storage has expiration and owner-authorized deletion, so Poros does not promise an undeletable track record.

| User need | What Arkiv provides | What a private database alone would lose |
|---|---|---|
| Inspect the discussed strategy | Version key, checked content hash, and author wallet | Readers depend on our API or export. |
| Preserve attribution when forking | Parent and fork-source references | Lineage remains controlled by our service. |
| Build another community client | Public schemas and direct queries | Developers need our permission or maintained API. |
| Identify the publisher of evidence | Native creator/owner metadata | Readers must trust our identity labels. |
| Understand availability | Explicit expiration block | Retention is only a backend policy. |

Postgres can store these fields. The difference is independent access to the public record and its native authorship metadata. Arkiv does not prove a strategy is profitable or that a later trade followed its rules.

## Why expiration fits

Trading ideas age. Strategy and durable community records default to 180 days; public chat uses 45 days. Communities can select and extend their lifetime, and the trade worker renews its evidence. Expired dependencies remain gaps, not a fabricated lifetime track record. Storage expiry cannot delete copies already downloaded.

## What stays off Arkiv

| Data | Storage | Reason |
|---|---|---|
| Exclusive messages and private strategy attachments | Encrypted Swarm content | Member content must not become public text. |
| Full Swarm references containing decryption material | Encrypted backend SQLite custody | Publishing the full reference would disclose access. |
| Pending jobs, leases, and recovery state | Persistent SQLite | Workers must recover uncertain transactions without duplicate actions. |
| Drafts and paper-run history | Browser state | Editing and simulation do not require public writes. |
| Credentials | Wallet, operator secrets, or browser storage for the user's inference key | Credentials authorize actions; they are not public records. |
| Quotes and historical candles | Market providers | We do not copy every price tick into Arkiv. |

Private delivery still depends on our backend and trusted Bee node. This is operator-managed encryption, not end-to-end encryption. Public hashes provide integrity, not secrecy for guessable content.

[Schema](schema.md) · [Integration](how-you-use-arkiv.md) · [Runnable query](../README.md#verify-the-public-data) · [Track criteria](https://ethglobal.com/events/mumbai/prizes/arkiv)
