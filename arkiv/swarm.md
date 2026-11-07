# Arkiv + Swarm: private creator content in Poros

Poros uses Swarm to store encrypted creator messages and attached strategy documents. Arkiv Rabdi stores the public records that connect those publications to creators and membership eligibility. Subscribers open the content through the application after proving wallet ownership; the backend checks access before retrieving and returning the message.

[Live application](https://poros-theta.vercel.app/) · [Membership workspace](https://poros-theta.vercel.app/community#/memberships) · [Arkiv schema](schema.md) · [Bonus requirements](https://ethglobal.com/events/mumbai/prizes/arkiv)

## What each system stores

| System | Stored data and responsibility |
|---|---|
| Swarm / Bee | Encrypted canonical JSON containing the creator's message and optional validated strategy document. |
| Arkiv Rabdi | Creator plans, membership/payment evidence, and public publication pointers with creator authorization. |
| EC2 backend / SQLite | Encrypted drafts, full encrypted Swarm references, publication jobs, and transaction recovery state. |
| Browser | Wallet interaction and display of content returned after authentication. |

The backend is part of the access model. The operator and trusted Bee service can access plaintext; this is not end-to-end encryption between creator and subscriber. A member who receives content can retain a copy after membership expires.

## Arkiv pointer format

Publications use the `ethmumbai.social.v1.events` namespace. A relay publication has event type `private-signal-relay`. Inside the decoded event's `data`, the **`swarmAddress`** field holds the public 64-character Swarm address. The event is serialized in the entity's `record` bytes attribute; `swarmAddress` is not a separate indexed attribute.

The pointer also carries `format: "swarm-message/1"`, `publicationId`, `payloadHash`, and `source`. The payload hash is checked against the canonical content after retrieval. Relay records include the creator's signed authorization.

An encrypted Bee upload returns a 128-character reference containing the address and decryption material. Poros publishes only the address portion. The full reference stays encrypted in backend custody with AES-256-GCM. Publishing the complete reference would disclose the key and bypass the intended membership gate.

## Public evidence

The following publication was read from Rabdi on **7 November 2026** through the application's validating event repository:

| Field | Observed value |
|---|---|
| Arkiv entity key | `0x46dbf4f5590280f14c8dd57d78380836bac1f2b47f64bd6bdb5c49b874af606d` |
| Native writer / relay | `0x66b9110bda6fa6dc1ec50d1595fdf277fbaebbd3` |
| `data.swarmAddress` | `ed263795c77413614061aa5c5a0d52fe9a068a7101b9fea14d19171ec9857498` |
| `data.publicationId` | `6d50e4c5-e559-40d7-bc7a-8d7abe43217a` |
| `data.payloadHash` | `0x70afe881c79d06d56c096c55af8655e054337d0b36603c04017f50889410a8ef` |
| Format | `swarm-message/1` |

[Open this entity in the Rabdi Explorer](https://rabdi.explorer.arkiv.network/entity/0x46dbf4f5590280f14c8dd57d78380836bac1f2b47f64bd6bdb5c49b874af606d).

The explorer link exposes public pointer evidence, not decrypted member content. To demonstrate delivery, use the application as the creator or an eligible member. A public plaintext link or a full decryption reference is deliberately not included.

## Bee node and postage

The active backend runs on AWS EC2. Bee runs as the `bee` service in [Docker Compose](../deploy/compose.yaml), using `ethersphere/bee:2.8.3`, persistent node storage, and a loopback API at `http://127.0.0.1:1633`. The Bee API is not a public browser endpoint.

On **7 November 2026**, the configured upload batch was checked through `GET /stamps/<batch-id>`:

```text
Batch ID: bb8490201fb903d9958d4196904e429b010c9a08fac68e4b741cbdd2c13df264
HTTP response: 200
Usable: true
Depth: 18
```

This verifies the current configured batch and its usability. It does not independently prove which batch stamped the historical entity above.

### Postage purchase evidence

The team supplied the wallet and transaction below. A read-only Gnosis RPC check on 7 November 2026 confirmed a successful receipt and a `BatchCreated` event matching the configured batch ID above.

| Field | Evidence |
|---|---|
| Network | Gnosis, chain ID `100` |
| Purchasing wallet / batch owner | `0x13cE57509228f42c123A6C97a133dA45F2397F94` |
| Transaction | [`0xdc30a6b8aee215f1d8e3cbd8202b514b35c57b8286dfeb478f93395da5a9be8f`](https://gnosisscan.io/tx/0xdc30a6b8aee215f1d8e3cbd8202b514b35c57b8286dfeb478f93395da5a9be8f) |
| Receipt | Success; block `49143467` |
| Emitting contract | `0x45a1502382541cd610cc9068e88727426b696293` |
| Matching batch ID | `bb8490201fb903d9958d4196904e429b010c9a08fac68e4b741cbdd2c13df264` |

[Public receipt evidence](evidence/swarm-postage-receipt.json) · [Team contacts](../SUBMISSION.md#team)

This establishes purchase of the configured batch, not which batch stamped a specific historical publication.

## Implementation references

| Responsibility | Source |
|---|---|
| Encrypted upload and content retrieval | [member-content.ts](../src/features/builder/server/member-content.ts) |
| Pointer validation and canonical content hash | [member-content.ts](../src/integrations/arkiv/community/member-content.ts) |
| Wallet-signed publication/read requests | [member-content-api.mjs](../src/features/builder/server/member-content-api.mjs) |
| Protected reference custody and durable jobs | [member-content-state.ts](../src/features/builder/server/member-content-state.ts) |
| Publication relay and recovery | [membership-relay.ts](../src/features/builder/server/membership-relay.ts) |
| Creator authorization checks | [membership-intent.ts](../src/integrations/arkiv/community/membership-intent.ts) |
| Membership eligibility | [memberships.ts](../src/integrations/arkiv/community/memberships.ts) |
| Creator/subscriber interface | [creator-membership.ts](../apps/web/src/creator-membership.ts) |

Uploads use Bee `POST /bytes` with `swarm-encrypt: true`, the configured `swarm-postage-batch-id`, and `swarm-deferred-upload: false`. The backend preserves the returned reference before read-back and verifies the retrieved content hash. Reads use `GET /bytes/<full-reference>` inside the backend, after wallet and membership checks. The full reference is never sent to the browser.

## Reproduce one upload and one read

Use the [runtime setup guide](../apps/web/README.md#encrypted-swarm-message-setup) for Node.js, Bee, the persistent database, relay funding, and server-only configuration. Preserve the existing database and master key on an existing deployment. Initialize storage only for a new installation.

1. Open the live application and connect the creator wallet on Rabdi. Set up a creator profile and membership plan if needed.
2. In the creator workspace, compose a new exclusive message. Use content intended for the demo; optionally attach a supported strategy. Approve publication with the creator wallet.
3. The backend uploads encrypted JSON, retrieves it to verify the hash, and publishes the authorized Arkiv pointer. Wait for confirmed publication and inspect its entity in the explorer. Expected: `swarm-message/1`, a 64-character `swarmAddress`, and no full reference or plaintext body.
4. As the creator, open the message and approve the read authentication. Expected: the backend returns the original message after validating the stored pointer and payload hash.
5. To demonstrate subscriber access, use a second wallet with a confirmed membership that was valid when this message was published and remains valid now. Open the message and sign the read authentication. A new subscription does not grant earlier-message access.
6. Repeat with a wallet without eligibility. Expected: access is denied, and neither plaintext nor the full reference is returned.

Publishing consumes Swarm postage and Arkiv testnet storage gas. Membership purchase has its own payment and gas requirements. Opening an existing message uses authentication; it does not purchase that message separately. Do not blindly retry an uncertain upload or payment; inspect the persisted job and transaction state first.

## Demo evidence to finish

The team confirms a demo was submitted on ETHGlobal and supplied `2:35–3:15` as an evidence reference. The shareable URL and confirmation that this section shows Swarm remain pending. The Swarm segment should show the creator publishing, an eligible member reading the same message, and the public Arkiv pointer, explaining that the public address omits the decryption key.

## Friction and limits

The integration required understanding Bee node operation, funding, postage, encrypted upload references, and the distinction between a public address and a full decryption reference. Documentation was spread across several guides; a single upload/read walkthrough with reference-safety guidance would have shortened the setup. See [our feedback](friction.md#5-swarm-documentation).

Persistent reference custody is necessary for member delivery. Losing that database or its master key can make existing publications unreadable through the app even while Swarm retains the ciphertext. Membership expiration prevents later app delivery, not copying content already received. The observations above establish public pointer records and current stamp health; they are not a fresh paid publication-and-subscriber-read test.
