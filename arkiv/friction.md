# Arkiv and Swarm feedback

## 1. Creation-block filtering

- **Problem:** SDK 1.0.1 returns `$createdAt` but rejects filtering on it.
- **Workaround:** paginate by key, then filter creation blocks locally.
- **Request:** support creation-block filters or an incremental cursor.

Reproduced on 7 November 2026: this throws `InvalidPredicateError` before an RPC request.

```js
import { gte } from "@arkiv-network/sdk/query";
import { u64 } from "@arkiv-network/sdk/schema";
gte("$createdAt", u64(1n));
```

[Implementation](../src/integrations/arkiv/community/repository.ts)

## 2. Slow reads

- **Problem:** Profile and Communities sometimes took one to two minutes. Our overlapping requests and shared-endpoint rate limits contributed.
- **Workaround:** access key, request deduplication, concurrency limits, and backoff.
- **Request:** clear quota errors and SDK examples for coordinating reads.

Inspect normal navigation traffic for duplicate requests and rate-limit responses. [Implementation](../src/features/builder/server/arkiv-reads.mjs)

## 3. Missing transaction links

- **Problem:** our ordinary entity reads do not return the creation transaction hash.
- **Workaround:** save hashes from write responses.
- **Request:** a documented transaction lookup by entity key.

Compare `getEntity` with a saved `createEntity` response. [Record type](../src/integrations/arkiv/community/contracts.ts)

## 4. Expired dependencies

- **Problem:** a fork or membership claim can outlive the record it references.
- **Workaround:** report missing history and renew trade evidence.
- **Request:** examples for extending related records together.

Reproduce with a fixture: remove a referenced record, then read its dependent history. [Membership tests](../tests/integrations/arkiv/memberships.test.ts)

## 5. Swarm documentation

- **Bee was hard to understand initially.** Its definition exists in the [glossary](https://docs.ethswarm.org/docs/references/glossary/#bee), but should appear at the start: Bee is Swarm node software; production contracts use Gnosis Chain.
- **Guidance felt scattered.** We had to move between [setup](https://docs.ethswarm.org/docs/bee/installation/getting-started/), [uploads](https://docs.ethswarm.org/docs/develop/upload-and-download/), and [encryption](https://docs.ethswarm.org/docs/develop/tools-and-features/store-with-encryption/). Finding the complete path took too long during the hackathon.
- **The [Book of Swarm](https://www.ethswarm.org/book-of-swarm/) is useful but too extensive for quick integration.** Add a short practical guide alongside it.
- **Request:** one walkthrough covering Bee, funding, postage, encrypted upload, read-back, and which references can safely go into public Arkiv entities.
- **Request:** The documentation does not follow the learning curve of a new user that is learning and then implementing it on the other hand.