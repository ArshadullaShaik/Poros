# Poros

Next.js App Router pages and Node API routes serve the strategy builder and Arkiv community on one origin. Requires Node 24+.

From the repository root, run these commands in order.

    npm --prefix src/integrations/arkiv ci --ignore-scripts
    npm --prefix apps/web ci --ignore-scripts
    npm --prefix apps/web run dev

The server uses http://127.0.0.1:4325 by default. The builder is at /, community at /community, and the explicitly read-only preview at /community?preview=1. Set PORT to use another port.

Public community reads use Arkiv Rabdi. Wallet-signed writes require an injected EIP-1193 wallet and Rabdi tGLM. New discussion records last 180 days and public chat lasts 45 days. Existing records retain their original expiry.

Use Chrome with MetaMask for the local wallet walkthrough. Open Communities in the shared navigation, then choose Create community, connect your disposable test wallet, and approve adding or switching to Rabdi when prompted. After funding the wallet with Rabdi tGLM, enter the community details and approve creation. Poros verifies the stored record before opening the community. Every wallet can create a community. The in-app browser shows instructions when a wallet extension is unavailable.

The source community and Arkiv modules were imported from surana-rishabh/holyfucc commit 1341eeec2e009ce928e7ca1d7f212e85563286ac. Arkiv stores community and creator-membership records.

## Cloud deployment

Use [the Vercel and persistent backend setup](../../deploy/README.md) for deployment. The Vercel website proxies API requests to the persistent backend; the membership database, relay wallet, worker, and Bee stay on that server.

## Creator memberships

Open Your profile in Chrome with MetaMask and publish a positive Rabdi tGLM price for a 30-day membership. No encryption identity or recovery code is needed for new messages. Public profiles show verified active subscriber counts.

Subscribers review the creator, exact price, and Rabdi network before paying. A purchase needs one wallet transaction approval: native tGLM goes directly to the creator, with the plan and request bound in transaction data. After two confirmations, the app-funded membership worker verifies payment and writes the activation record automatically. Access starts at the verified payment block. Check activation recovers the original payment without another transaction. Existing Sepolia plans retain their currency and original claim recovery; creators must explicitly publish a new tGLM price to migrate. An early renewal extends the existing term. Interrupted payments retain the original transaction for recovery; do not send another payment to fix an uncertain one.

Creators publish exclusive messages through the existing composer. The creator signs one exact publication authorization. The membership worker uploads the message and optional paper-strategy JSON to Bee with Swarm encryption, reads it back, and pays for the Arkiv publication automatically. The creator does not approve an additional Arkiv transaction. Opening the private composer and finishing publication do not open the signed read feed. Titles and bodies stay off Arkiv. The backend retains the full secret reference encrypted at rest. A wallet signature confirms access when opening a feed (up to 20 eligible posts per signature); it is not another payment. There are no recipient-delivery transactions.

Members must be active both now and when the message was published. Same-block claims do not establish eligibility. New subscribers do not receive the earlier archive, and renewing after a gap does not unlock posts from the unpaid period. Creators can read and publish without self-subscribing. Expiry clears in-app messages; previously received content can be copied and cannot be revoked. Older encrypted posts show a legacy-access explanation and are not automatically migrated. Old interrupted writes are retained for the previous recovery flow.

### Encrypted Swarm message setup

Set these server-only variables in the deployment secret store or root `.env.local`, then restart the app:

| Variable | Value |
|---|---|
| `SWARM_BEE_URL` | Trusted Bee API URL; loopback HTTP or remote HTTPS |
| `SWARM_POSTAGE_BATCH_ID` | Funded Bee batch ID: 64 lowercase hex characters, without `0x` |
| `MEMBERSHIP_DB_PATH` | Absolute path to a dedicated SQLite file on a persistent volume, separate from the trade ledger |
| `MEMBERSHIP_MASTER_KEY` | Base64 encoding of a random 32-byte key; retain it across restarts |
| `MEMBERSHIP_RELAY_PRIVATE_KEY` | Dedicated server wallet private key (`0x` + 64 hex), funded with Rabdi tGLM; never reuse a personal or trade-writer key |
| `MEMBERSHIP_ORIGIN` | Exact browser origin, e.g. `http://127.0.0.1:4325`; HTTPS for a remote origin |
| `SWARM_BEE_AUTHORIZATION` | Optional Authorization header value for a protected Bee deployment |

Before the first start, run `npm --prefix apps/web run membership:init` once to create an empty custody database. This does not upload or spend funds. Normal startup refuses a missing database, and initialization refuses to overwrite an existing one. If an existing volume is lost, restore its backup rather than initializing a replacement.

Fund the dedicated relay address using the [Rabdi faucet](https://hub.arkiv.network/faucet). `npm --prefix apps/web run dev` and `start` supervise the membership worker automatically when its key is configured. `build` never launches it. You can also run `npm --prefix apps/web run membership:worker` on the persistent backend host; only one worker may sign at a time. The API preflight requires a healthy, funded worker before a new payment or publication signature. The app pays the background Arkiv write gas; users still pay their membership price and payment gas.

The existing `ARKIV_ACCESS_KEY` and optional `SEPOLIA_RPC_URL` configure server verification. Trade-writer credentials and the trade worker are not required for member messages. Bee's `POST /bytes` encrypted upload and `GET /bytes/<full-reference>` are used directly; no extra npm package is needed.

Only the address portion of a reference goes into Arkiv. The full encrypted reference contains a decryption key: never publish it, log it, or put it in a public URL. The backend retrieves through the configured trusted Bee node and returns verified plaintext to an authenticated member over HTTPS. This is operator-managed encryption, not end-to-end encryption; the operator and trusted Bee node can access content. Public payload hashes are integrity commitments and do not hide guessable content.

Back up the membership SQLite database consistently (including SQLite WAL semantics) and retain its master key separately. Missing custody state or a wrong key fails closed. Do not replace the database/key on deployment. Keep the API and a single membership worker on the same persistent host/volume. A SQLite lease serializes workers, and encrypted jobs save the exact signed transaction before broadcast. An unresolved transaction is reconciled or rebroadcast unchanged, blocking other relay signing until resolved. Do not use this wallet from another process or restore an older DB while its transactions are pending. Multi-host replicas and key rotation are not implemented. Vercel alone cannot provide this persistent SQLite/long-running-worker deployment; host the membership backend and Bee on a persistent server and route the member-content API from the same browser origin. Both creator and subscriber must use the same membership backend, including when testing on two laptops; separate local databases cannot open each other's posts.

Uploads are journaled. A returned Swarm reference survives a failed read-back or rejected Arkiv transaction, so recovery can reuse it. Recover uncertain Arkiv writes with the original request ID. Recovery checks the original entity/request and never resubmits an unresolved transaction. A new attempt is allowed only after a known wallet rejection or a canonically confirmed failed transaction; an unknown transaction without a hash may need operator reconciliation. An upload that times out before its reference is saved may leave an orphan; only the explicit Retry upload action can spend postage again. There is no plaintext fallback. Keep postage funded; expired batches can make content unavailable.

Limits per running process: four concurrent Bee operations, 30 challenge requests/minute/IP, 10 uploads/minute/wallet, and 60 read requests/minute/wallet. Individual requests are at most 64 KiB; canonical message content is at most 8,800 bytes, with a 100-byte title and 4,096-byte body. The sidebar shows the newest 20 eligible posts; the member feed provides Older messages and Newer messages when needed. Public deployment of the rest of the app still needs its existing localhost-only API rules addressed separately.

For an explicitly authorized live demo, use a funded Bee batch and an existing eligible membership. Publish a distinctive exclusive message, verify the creator-authorized Arkiv pointer has no key or plaintext, open it as creator and subscriber, and confirm a non-member cannot retrieve it. Restart the backend using the same database/key and repeat the read. No live upload, extra payment, or trade is performed by the fixture tests. A successful build alone does not establish that the Bee deployment works.

The default Sepolia read service is exposed through the local /api/sepolia-rpc endpoint. Set SEPOLIA_RPC_URL in the server environment to use a different HTTPS provider. RPC credentials stay on the server. The Rabdi public endpoint can rate-limit reads.

## Public strategy editing

Home and Communities are available in the header, and the Poros icon opens Home. Publish to community opens a review page for the complete public strategy document and its license. A selected Arkiv version can be opened directly or dragged from a strategy card onto the builder canvas. Editing that selection preserves its source for a wallet-signed fork. Share in a community attaches the exact version to a discussion post.

The real builder validator checks the graph, envelope, network, and token registry. This demo uses its configured local paper-token registry. The Ethereum execution registry and authorized live-trading flow remain separate integration work.

## Two-laptop walkthrough

Run this branch locally on both laptops with Node 24 or newer. Each laptop uses its own MetaMask account. Both read the same public Arkiv records. New exclusive messages additionally require both browsers to use the same configured membership backend, as described above. Use the creator's complete profile URL on the subscriber laptop, changing only the local port if needed. Both wallets need Rabdi tGLM, and the subscriber needs Sepolia ETH. The local server binds to loopback.

The builder offers virtual-fund modes and separately wallet-authorized live execution. Live AI requests require the user's 0G key. Private keys and API secrets must stay out of the repository. A failed live read remains an error. Preview content never replaces a failed network request.

Historical backtesting opens from the compact Test your strategy button below Building blocks on Trade. Click it to open setup, or drop a library strategy on the button to open setup with that strategy. In the popup, click or drag a ready-made 7-day, 30-day or 90-day setup into the test area, then use the current canvas strategy or drop a verified library strategy. Choose Run backtest to review results. Market, UTC dates (exclusive end), interval, balance, turnover, fees and slippage remain available under Advanced settings. Dropped text-only strategies use the existing paid 0G interpretation flow; backtesting itself makes no AI request. The server fetches up to 500 historical Coinbase candles including RSI warm-up, rejects gaps, and uses close-time signals with next-open fills. Price-range actions fill once per run; a next-open price outside the target is rejected. Market changes update the loaded strategy explicitly. Historical USD prices are proxies for the selected on-chain token/stablecoin pair, not historical Flash fills; unsupported Coinbase markets remain unavailable. Reports show returns, candle-close drawdown, filled orders, closed sell-fill statistics, fees/slippage, buy-and-hold comparison, and individual fills. No wallet or AI request is needed for a backtest. Perpetuals and leverage are not included.

Creator links in Trade open the public profile with finalized Flash fill statistics, public Arkiv strategy/version history and public community chat. Full portfolio return, drawdown and benchmark metrics remain unavailable without starting-equity and deposit history. Available Flash history is limited to 50 recent orders, and expired Arkiv publications may be missing. Chat reuses existing community membership and moderation rules; messages are public and writes require wallet approval and Rabdi gas.

The 0G inference key is saved in this browser's local storage across reloads and browser restarts. Forget key removes it. Scripts running on the same site can read it; use a dedicated inference key. If storage is blocked, the key remains usable in memory and the settings report that it was not saved.

## Verified live trade recording on Arkiv

The Members tab lists creator profiles, their 30-day membership price, a profile link, and **Buy membership**. Active subscribers get **Open messages**; expired memberships can be renewed. Membership is the purchase: there is no per-message checkout. Opening encrypted messages with a recovery code does not send a payment. Existing publication-time eligibility and encryption checks still apply.

Profile also includes **Set username / Edit username** and public username lookup. Saving uses the existing wallet-approved Arkiv profile write, linking the lowercase handle to its author wallet. Open `/profile#/profile/@username` to retrieve the current profile by handle. Existing shared handles show matching wallet choices instead of silently selecting a different trader. Renaming retains the wallet identity; the previous handle stops matching that wallet's current profile. Profile pages no longer embed community chat; community conversations remain in Communities.

Real execution history has a separate Arkiv ledger. Profiles and the profit leaderboard read records from its configured trusted writer; local receipts and trader-supplied profits are not verified history. Trading sources are registered through the wallet-proved source-link API; the setup card is no longer displayed on Profile. Linking publishes executions, including losses. Unlinking retains attributed records and excludes that incomplete source from ranking. Linking a Solana trading wallet requires its message signature as well as the EVM profile signature. Portfolio access additionally checks the profile against the provider's vault signers.

Configure these **server-only** variables in the root `.env.local` or deployment secret store:

| Variable | Value |
|---|---|
| `ARKIV_ACCESS_KEY` | Existing Rabdi RPC access key |
| `ARKIV_TRADE_WRITER_PRIVATE_KEY` | Dedicated storage-writer key, never a trader's wallet key |
| `ARKIV_TRADE_TRUSTED_WRITER` | That writer's EVM address |
| `TRADE_LEDGER_DB_PATH` | Absolute path on a persistent local volume, shared by the app and worker |
| `TRADE_LEDGER_ORIGIN` | Exact app origin, e.g. `http://127.0.0.1:4325` |
| `FLASH_API_KEY` | Authorized Flash history access; there is no development-key fallback for the ledger |
| `DEFINITIVE_PORTFOLIO_CREDENTIALS_FILE` | Optional operator-only JSON secret file for portfolio history |

The portfolio secret file maps provider portfolio IDs to `{ "key": "<portfolio API key>", "secret": "<portfolio API secret>" }`. Keep it outside public/static paths with permissions `0600`; no credentials are uploaded through the profile UI. The provider's portfolio metadata must include the selected vault and profile signer. Configure one portfolio API credential pair per portfolio; organization-wide credential routing is not assumed.

Fund the dedicated writer with Rabdi **tGLM** for storage, then restart the app and run a separately supervised worker:

```sh
npm --prefix apps/web run trade:worker
# One reconciliation pass for operations/debugging:
npm --prefix apps/web run trade:worker -- --once
```

Use Node 24 or newer with built-in SQLite. Keep the app and worker on the same host/persistent volume; this implementation is not a distributed queue. Back up the SQLite database using a consistent SQLite backup or stop both processes before copying its database and WAL. Preserve the database when deploying or restarting. The worker holds an expiring database lease, persists pagination and reconciles uncertain inclusion before attempting another write. A recording error never resubmits a trade. Real app orders require a linked Flash source and a healthy worker before submission; paper trading does not require the ledger.

The worker refreshes linked sources, retains finalized partial fills even for cancelled orders, and renews records with fewer than 30 days remaining to a 180-day expiry. Monitor `/api/trade-history/status?trader=<profile-address>` for worker health, pending records, source errors and renewal failures. Missing/expired previously confirmed entities or unknown inclusion remain explicit gaps. Do not reset the database, change the trusted writer, or clear an uncertain write to hide a gap; reconcile its chain transaction/entity and restore consistent state first. Writer rotation requires preserving trust in prior attestations and is not an automatic key swap.

Reports show gross realized fill P/L with provider-reported USD fees separately; they do not assume a USD conversion for the settlement currency or present net returns. Open gains, external sources and portfolio return/drawdown are not inferred. Pagination and cost basis must be complete; stale, unlinked, disputed or incomplete sources cannot receive a profit rank. Source visibility is limited by the configured Definitive API authorization. A current Arkiv record is an attestation by this app's verifier, not independent transaction verification or proof of a trader's reliability.

Report generation currently fails visibly above 10,000 ledger records instead of returning a truncated ranking. Materialized reports are the upgrade path for larger histories. Mirrored executions from the same funding wallet exposed through both Definitive APIs are deduplicated by their execution identities; contradictory observations remain disputed. Pagination coverage uses the first page's observation time so a long backfill does not claim newer orders were checked at the end.

Deployment is not live-verified until a funded writer has performed an inclusion/read-back check and a linked source's actual executions have been reconciled. Fixture tests and a successful build do not establish that your historical trades have been imported. Never use a real-money test trade merely to test recording.

After explicitly opting in, stop the regular worker and run `npm --prefix apps/web run trade:smoke` with `ARKIV_TRADE_LIVE_SMOKE=1` and `TRADE_LEDGER_SMOKE_TRADER` set to a linked profile. The check imports available real executions, reads a real fill back, repeats its identity without creating another record, and renews its expiry. It spends storage gas and does not place a trade. Restart the regular worker afterwards.

## Checks

    npm --prefix src/integrations/arkiv test
    npm --prefix src/integrations/arkiv run typecheck
    npm --prefix apps/web test
    npm --prefix apps/web run typecheck
    npm --prefix apps/web run build

## Next.js runtime

For a production-style local demo, run `npm --prefix apps/web run build` followed by `npm --prefix apps/web start`. `npm --prefix apps/web run dev` enables development compilation. Root `.env.local` is loaded only by the server launcher.

Home, Trade, Orders, Communities, Profile, and 0G Pot share one header, logo, and theme. Trade and Orders share a persistent layout so switching between them keeps the draft and active run in memory. Other workspaces use full-document navigation to preserve the builder draft warning and clear in-memory private keys when leaving the trading workspace. Community deep links retain their existing hash routes. The existing canvas and community controllers run inside Next client boundaries.

Run the production build before the web tests, which verify the actual Next server and generated assets.

## Arkiv query load

Set `ARKIV_ACCESS_KEY` in the root `.env.local` to use an Arkiv account's query allowance, then restart the server. The key is used server-side and must stay out of Git. This does not remove the provider's quota.

The Arkiv proxy merges identical in-flight reads across callers, bounds upstream concurrency to four with a queue of 32, and honors rate-limit cooldowns with `Retry-After`. Only chain identity is cached for 60 seconds; entity, query, block timing and transaction verification results are not cached by this proxy. Browser public-list caching keeps its five-minute age limit and backs off failed refreshes from 15 seconds up to two minutes. Membership/payment verification does not use that stale public cache.

Coordination is per running server process. Multiple production replicas need shared coordination (for example a Redis queue/cache) or an indexed public feed service to maintain the same limits across the deployment; this implementation does not claim unlimited horizontal scale.
