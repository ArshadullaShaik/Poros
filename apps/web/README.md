# Poros runtime

Node.js **24+**. See the [root README](../../README.md#run-locally) for installation and [verification](VERIFICATION.md) for checked results.

`npm --prefix apps/web run dev` serves `http://127.0.0.1:4325`; set `PORT` to change it. Production: build, then `npm --prefix apps/web start`. These launchers load root `.env.local`. Build never starts the membership worker.

Public reads use Rabdi. Signed writes need an injected wallet and tGLM. The explicit preview is `/community?preview=1`; it never replaces failed live reads.

## Cloud deployment

The Vercel frontend forwards APIs to a persistent backend. Configure:

| Variable | Where / value |
|---|---|
| `POROS_BACKEND_URL` | Frontend: canonical HTTPS backend origin. Loopback HTTP is allowed locally. |
| `POROS_PROXY_SECRET` | Frontend and backend: identical random secret, at least 32 characters. |
| `MEMBERSHIP_ORIGIN` | Backend: exact HTTPS website origin. |
| `HOST`, `PORT` | Backend listener; defaults to `127.0.0.1:8080`. |

Start the configured backend with `npm --prefix apps/web run backend`. Its environment must contain the service settings below. The gateway checks the proxy secret and origin; `/healthz` is only a process health response, not proof that every integration works. See [deployment code](../../src/features/builder/server/deployment.mjs).

Keep the API, membership worker, and custody database on the same persistent host/volume. Both creator and subscriber must use that backend; separate laptop databases cannot open each other's private posts. Keep Bee on a trusted service and preserve its identity/state.

## Creator memberships

- New plans: a positive tGLM price for 30 days, paid directly to the creator on Rabdi.
- Payment data binds the plan/request. After two confirmations, the relay verifies payment and writes activation; access starts at the verified payment block.
- Recover uncertain activation from the original payment. Do not pay again to fix it. Early renewal extends the term.
- Existing Sepolia plans retain their old currency/recovery. Migration requires an explicit new tGLM plan.
- Creator-approved private publication uses one signature. The worker encrypts/uploads to Bee, reads back, then pays for the Arkiv pointer write.
- Members must be eligible now and at publication. Same-block claims, later subscriptions, and unpaid gaps do not unlock earlier messages.
- Creators can access their own posts. Reads use wallet authentication, not another payment. New posts need no recovery code; legacy encrypted records retain their own access limitations.
- Expiry clears in-app content, not copies already received.

### Encrypted Swarm message setup

Server-only variables:

| Variable | Value |
|---|---|
| `SWARM_BEE_URL` | Trusted Bee API; loopback HTTP or remote HTTPS. |
| `SWARM_POSTAGE_BATCH_ID` | Funded batch ID, 64 lowercase hex characters without `0x`. |
| `MEMBERSHIP_DB_PATH` | Absolute persistent SQLite path, separate from trade state. |
| `MEMBERSHIP_MASTER_KEY` | Base64 random 32-byte key; preserve across restarts. |
| `MEMBERSHIP_RELAY_PRIVATE_KEY` | Dedicated relay wallet, funded with Rabdi tGLM; never reuse a personal/trade key. |
| `MEMBERSHIP_ORIGIN` | Exact browser origin; HTTPS remotely. |
| `SWARM_BEE_AUTHORIZATION` | Optional protected-Bee authorization value. |
| `ARKIV_ACCESS_KEY` | Rabdi query access key. |
| `SEPOLIA_RPC_URL` | Optional HTTPS provider for legacy claim verification. |

Initialize only a **new** deployment with `npm --prefix apps/web run membership:init`. It refuses overwrite; normal startup refuses a missing database. If state is lost, restore its backup rather than creating an empty replacement.

Fund the relay through the [Rabdi faucet](https://hub.arkiv.network/faucet). Local `dev`/`start` supervise it when configured, or run `npm --prefix apps/web run membership:worker` on the backend. Only one worker may sign. Preflight requires it healthy and funded; users still pay their membership price/payment gas.

Bee uses encrypted `POST /bytes` and `GET /bytes/<full-reference>`. Arkiv receives only the address portion. Full references contain decryption material: never expose them in logs, public URLs, or entities. The backend returns verified plaintext over HTTPS after authentication. Operator and trusted Bee can access content; hashes alone do not hide guessable text.

### Recovery and operating limits

- Back up SQLite consistently, including WAL semantics; keep the master key separately. Preserve both across deployments. Wrong/missing custody state fails closed.
- A lease serializes workers; encrypted jobs retain signed transactions before broadcast. Unknown transactions are reconciled or rebroadcast unchanged before further signing.
- Do not use the relay wallet elsewhere or restore stale state over pending transactions. Multi-host replicas and key rotation are not implemented.
- Returned upload references survive later failures. Recover using the original request ID. Unresolved inclusion must not become another write; unknown hashless attempts may need operator reconciliation.
- A timeout before a reference is saved can orphan an upload. Only explicit Retry upload may spend postage again. No plaintext fallback; expired postage can make content unavailable.
- Limits per process: four Bee operations; 30 challenges/minute/IP; 10 uploads/minute/wallet; 60 reads/minute/wallet.
- Requests: 64 KiB maximum. Canonical content: 8,800 bytes, title 100 bytes, body 4,096 bytes. Feed reads up to 20 eligible messages per signature, with pagination.

Live validation requires a funded batch and eligible test membership: publish, inspect the public pointer, read as creator/member, reject a non-member, restart with preserved state, and repeat. Fixtures do not perform this paid walkthrough.

## Strategies and browser state

Public versions import into the canvas with lineage preserved for a signed fork. Written posts require paid 0G interpretation. Backtests use historical Coinbase USD proxies, close-time signals and next-open fills, fees/slippage assumptions, and bounded candles; gaps are rejected. These are not historical Flash fills. Backtesting itself requires no wallet or AI call. Perpetuals/leverage are unsupported.

Current live adapters submit Flash market orders; local price monitoring is not provider-managed advanced orders. Trade and Orders share draft/run state. Other workspaces use full-document navigation; community deep links keep hash routes.

The inference key persists in browser local storage when allowed. Same-origin scripts can read it. Use a dedicated key; Forget key removes it. Blocked storage leaves it memory-only.

## Verified live trade recording on Arkiv

Reports read a separate Arkiv ledger from a configured trusted writer. Browser receipts and self-reported profit are not verified history.

Linking a source publishes executions including losses. Unlinking retains records but excludes incomplete sources from ranking. Solana linking requires both Solana and EVM profile signatures; portfolio access checks provider vault signers.

| Server variable | Value |
|---|---|
| `ARKIV_ACCESS_KEY` | Rabdi query access. |
| `ARKIV_TRADE_WRITER_PRIVATE_KEY` | Dedicated funded storage writer. |
| `ARKIV_TRADE_TRUSTED_WRITER` | Writer EVM address trusted by readers. |
| `TRADE_LEDGER_DB_PATH` | Persistent absolute SQLite path shared by API/worker. |
| `TRADE_LEDGER_ORIGIN` | Exact application origin. |
| `FLASH_API_KEY` | Authorized history access; ledger has no development-key fallback. |
| `DEFINITIVE_PORTFOLIO_CREDENTIALS_FILE` | Optional private JSON mapping portfolio IDs to key/secret pairs. |

Keep portfolio credentials outside public paths with restrictive permissions (`0600` on Unix). Provider metadata must identify the selected vault/profile signer; organization-wide routing is not assumed.

```sh
npm --prefix apps/web run trade:worker
# One reconciliation pass:
npm --prefix apps/web run trade:worker -- --once
```

Keep API/worker on the same host and consistent persistent volume. Back up SQLite correctly or stop both before copying database/WAL. The worker leases state, persists pagination, and reconciles uncertain inclusion. Recording errors never resubmit trades. Live orders require a linked source and healthy worker; paper mode does not.

Finalized partial fills are retained even for cancelled orders. Records with fewer than 30 days remaining are renewed to 180 days. Monitor `/api/trade-history/status?trader=<profile-address>`. Missing evidence, uncertain writes, or renewal failures remain gaps. Do not reset state or swap writers to hide them; rotation needs a trust-preserving migration.

Reports show gross realized fill P/L and provider-reported USD fees separately. Gas, open gains, external activity, portfolio returns, and drawdown are not inferred. Incomplete, stale, disputed, or unlinked sources cannot rank. Mirrored executions are deduplicated by identity; contradictory evidence remains disputed. Reports fail above 10,000 records rather than truncate.

After explicit authorization, stop the normal worker and run `npm --prefix apps/web run trade:smoke` with `ARKIV_TRADE_LIVE_SMOKE=1` and `TRADE_LEDGER_SMOKE_TRADER` set to a linked profile. It imports existing executions, checks read-back/idempotency/renewal, and spends storage gas without placing a trade. Restart the worker afterward.

## Checks

Run [root checks](../../README.md#checks), building before web tests. A successful build does not prove imported live history or member delivery.

## Arkiv query load

The server key stays out of responses and Git. The proxy merges identical in-flight reads, allows four upstream requests and a queue of 32, and honors cooldowns. Only chain identity is cached for 60 seconds; entity/query/payment data is not cached there.

Browser public lists have a five-minute age limit and failed-refresh backoff from 15 seconds to two minutes. Membership verification does not use that stale cache. Coordination is per process; multiple replicas need shared coordination.
