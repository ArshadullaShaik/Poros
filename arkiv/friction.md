# Arkiv feedback

The difficult part was keeping reads, recovery, and history understandable after the first successful write.

## 1. Creation blocks cannot be filtered

We expected incremental reads to filter events after the last observed block. SDK 1.0.1 returns `$createdAt`, but rejects it in a predicate.

Run from `src/integrations/arkiv` after installing dependencies:

```sh
node --input-type=module -e '
import {gte} from "@arkiv-network/sdk/query";
import {u64} from "@arkiv-network/sdk/schema";
try { gte("$createdAt", u64(1n)); }
catch (error) { console.error(error.name + ": " + error.message); }
'
```

Reproduced on 7 November 2026: `InvalidPredicateError` says the field has no index. This happens before any RPC request.

**Workaround:** paginate a bounded type/scope by key, then filter creation blocks locally. Our [social repository](../src/integrations/arkiv/community/repository.ts) rejects scans above 500 live records rather than truncating them.

**Request:** indexed creation-block filters or an incremental-change cursor, plus a clear list of queryable native fields.

## 2. Overlapping reads made pages slow

Users reported waits of roughly one to two minutes on Profile and Communities. Components requested overlapping data while the shared endpoint was rate-limited. Our own request fan-out contributed; this was not a controlled Arkiv latency benchmark.

**Reproduction:** inspect normal navigation requests and quota responses without an access key. Rate limits depend on shared usage; do not load-test the public endpoint to force them.

**Workaround:** server-side access key, identical-request deduplication, four upstream slots, bounded queuing, and cooldowns. Public lists are cached briefly; payment/access verification does not trust that stale cache.

**Request:** SDK examples for shared reads, structured quota diagnostics, and guidance separating discovery caches from access checks.

Evidence: [RPC coordination](../src/features/builder/server/arkiv-reads.mjs), [tests](../apps/web/tests/arkiv-reads.test.ts).

## 3. Historical entities lack a creation receipt in our read path

A successful write returns a transaction hash. An ordinary entity read does not expose that receipt, so a newly loaded historical record may have an entity key but no transaction link.

**Reproduction:** compare `getEntity` fields with a saved `createEntity` response. Do not use an entity key as a transaction hash.

**Workaround:** retain hashes when available and keep entity navigation distinct. Our [event DTO](../src/integrations/arkiv/community/contracts.ts) makes `txHash` optional.

**Request:** a documented entity-to-creation-transaction lookup or receipt projection. This describes the read path we used, not a claim that provenance cannot be reconstructed elsewhere.

## 4. Expiring relationships need guidance

A fork can outlive its source, and membership evidence can depend on an expired plan. A present record does not prove its dependencies remain readable.

**Safe investigation:** remove a referenced record in a fixture repository, then request the dependent history. Existing [retention tests](../tests/integrations/arkiv/retention.test.ts) check lifetime choices; [membership tests](../tests/integrations/arkiv/memberships.test.ts) cover renewal evidence and access gaps. They do not cover every possible dependency.

**Response:** show missing evidence as a gap, separate membership terms from storage lifetime, and renew trade evidence through its funded writer.

**Request:** examples for extending related entities together and handling missing dependencies. We would prioritize incremental reads first, then request coordination, receipt lookup, and retention guidance.

[Track criteria](https://ethglobal.com/events/mumbai/prizes/arkiv) · [Rabdi](https://docs.arkiv.network/networks/rabdi/) · [Expiration](https://docs.arkiv.network/writing/expiration/)
