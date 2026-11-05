# Poros

Local strategy builder and Arkiv community on one origin. Requires Node 24+.

From the repository root, run these commands in order.

    npm --prefix src/integrations/arkiv ci --ignore-scripts
    npm --prefix apps/web ci --ignore-scripts
    npm --prefix apps/web run dev

The server prints its loopback URL. The builder is at /, community at /community, and the explicitly read-only preview at /community?preview=1. Set PORT to use another port.

Public community reads use Arkiv Rabdi. Wallet-signed writes require an injected EIP-1193 wallet and Rabdi tGLM. New discussion records last 180 days and public chat lasts 45 days. Existing records retain their original expiry.

Use Chrome with MetaMask for the local wallet walkthrough. Choose Create community in the builder marquee, connect your disposable test wallet, and approve adding or switching to Rabdi when prompted. After funding the wallet with Rabdi tGLM, enter the community details and approve creation. Poros verifies the stored record before opening the community. Every wallet can create a community. The in-app browser shows instructions when a wallet extension is unavailable.

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

The builder remains paper-only. Live AI requests require the user's 0G key. Private keys and API secrets must stay out of the repository. A failed live read remains an error. Preview content never replaces a failed network request.

## Checks

    npm --prefix src/integrations/arkiv test
    npm --prefix src/integrations/arkiv run typecheck
    npm --prefix apps/web test
    npm --prefix apps/web run typecheck
    npm --prefix apps/web run build
