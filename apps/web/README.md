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
