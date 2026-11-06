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

## Creator memberships

Open Your profile in Chrome with MetaMask. Create an encryption key, save its recovery code privately, and approve registration of its encrypted backup on Rabdi. Then publish a positive Sepolia ETH price for a 30-day membership. Public profiles show verified active subscriber counts.

A subscriber connects their own wallet, registers and unlocks their encryption key, and reviews the creator, exact price, and Sepolia network before sending payment. After two confirmations, Verify payment and activate checks the original receipt and asks for an Arkiv claim transaction. Access starts with that claim. An early renewal extends from the existing expiry. Interrupted payments stay in local recovery storage until their original transaction is verified. Keep the original transaction hash when recovering on a different browser.

Creators review a signal, encrypt it, and approve its Arkiv publication. Each eligible subscriber then needs a separate recipient-envelope transaction from the creator. Complete delivery resumes an interrupted delivery. A pending write has its own recovery action. Subscribers receive posts published after their membership claim, with same-block claims conservatively excluded. Received information can be copied. The app hides the feed after membership expiry.

Private keys and recovery codes stay in browser memory. Reloading requires the recovery code to unlock the Arkiv backup. Losing that code can make received signals unreadable. Record lifetime remains 180 days. The app checks that the plan, key history, and renewal evidence have enough remaining lifetime before offering payment.

The default Sepolia read service is exposed through the local /api/sepolia-rpc endpoint. Set SEPOLIA_RPC_URL in the server environment to use a different HTTPS provider. RPC credentials stay on the server. The Rabdi public endpoint can rate-limit reads.

## Public strategy editing

Home and Communities are available in the header, and the Poros icon opens Home. Publish to community opens a review page for the complete public strategy document and its license. A selected Arkiv version can be opened directly or dragged from a strategy card onto the builder canvas. Editing that selection preserves its source for a wallet-signed fork. Share in a community attaches the exact version to a discussion post.

The real builder validator checks the graph, envelope, network, and token registry. This demo uses its configured local paper-token registry. The Ethereum execution registry and authorized live-trading flow remain separate integration work.

## Two-laptop walkthrough

Run this branch locally on both laptops with Node 24 or newer. Each laptop uses its own MetaMask account and saved encryption recovery code. Both read the same public Arkiv records. Use the creator's complete profile URL on the subscriber laptop, changing only the local port if needed. Both wallets need Rabdi tGLM, and the subscriber needs Sepolia ETH. The local server binds to loopback.

The builder offers virtual-fund modes and separately wallet-authorized live execution. Live AI requests require the user's 0G key. Private keys and API secrets must stay out of the repository. A failed live read remains an error. Preview content never replaces a failed network request.

Historical backtesting opens from the compact Test your strategy button below Building blocks on Trade. Click it to open setup, or drop a library strategy on the button to open setup with that strategy. In the popup, click or drag a ready-made 7-day, 30-day or 90-day setup into the test area, then use the current canvas strategy or drop a verified library strategy. Choose Run backtest to review results. Market, UTC dates (exclusive end), interval, balance, turnover, fees and slippage remain available under Advanced settings. Dropped text-only strategies use the existing paid 0G interpretation flow; backtesting itself makes no AI request. The server fetches up to 500 historical Coinbase candles including RSI warm-up, rejects gaps, and uses close-time signals with next-open fills. Price-range actions fill once per run; a next-open price outside the target is rejected. Market changes update the loaded strategy explicitly. Historical USD prices are proxies for the selected on-chain token/stablecoin pair, not historical Flash fills; unsupported Coinbase markets remain unavailable. Reports show returns, candle-close drawdown, filled orders, closed sell-fill statistics, fees/slippage, buy-and-hold comparison, and individual fills. No wallet or AI request is needed for a backtest. Perpetuals and leverage are not included.

Creator links in Trade open the public profile with finalized Flash fill statistics, public Arkiv strategy/version history and public community chat. Full portfolio return, drawdown and benchmark metrics remain unavailable without starting-equity and deposit history. Available Flash history is limited to 50 recent orders, and expired Arkiv publications may be missing. Chat reuses existing community membership and moderation rules; messages are public and writes require wallet approval and Rabdi gas.

The 0G inference key is saved in this browser's local storage across reloads and browser restarts. Forget key removes it. Scripts running on the same site can read it; use a dedicated inference key. If storage is blocked, the key remains usable in memory and the settings report that it was not saved.

## Verified live trade recording on Arkiv

Profile also includes **Set username / Edit username** and public username lookup. Saving uses the existing wallet-approved Arkiv profile write, linking the lowercase handle to its author wallet. Open `/profile#/profile/@username` to retrieve the current profile by handle. Existing shared handles show matching wallet choices instead of silently selecting a different trader. Renaming retains the wallet identity; the previous handle stops matching that wallet's current profile. Profile pages no longer embed community chat; community conversations remain in Communities.

Real execution history has a separate Arkiv ledger. Profiles and the profit leaderboard read records from its configured trusted writer; local receipts and trader-supplied profits are not verified history. A trader links a Flash funding wallet or a Definitive portfolio from **Profile → Verified trading history**. Linking publishes executions, including losses. Unlinking retains attributed records and excludes that incomplete source from ranking. Linking a Solana trading wallet requires its message signature as well as the EVM profile signature. Portfolio access additionally checks the profile against the provider's vault signers.

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
