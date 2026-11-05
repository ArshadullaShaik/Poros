# Poros

Local strategy builder and Arkiv community on one origin. Requires Node 24+.

From the repository root, run these commands in order.

    npm --prefix src/integrations/arkiv ci --ignore-scripts
    npm --prefix apps/web ci --ignore-scripts
    npm --prefix apps/web run dev

The server prints its loopback URL. The builder is at /, community at /community, and the explicitly read-only preview at /community?preview=1. Set PORT to use another port.

Public community reads use Arkiv Rabdi. Wallet-signed writes require an injected EIP-1193 wallet and Rabdi tGLM. New discussion records last 180 days and public chat lasts 45 days. Existing records retain their original expiry.

The source community and Arkiv modules were imported from surana-rishabh/holyfucc commit 1341eeec2e009ce928e7ca1d7f212e85563286ac. Its SQLite marketplace server is excluded. Creator memberships are a separate feature under implementation.

The builder remains paper-only. Live AI requests require the user's 0G key. Private keys and API secrets must stay out of the repository. A failed live read remains an error. Preview content never replaces a failed network request.

## Checks

    npm --prefix src/integrations/arkiv test
    npm --prefix src/integrations/arkiv run typecheck
    npm --prefix apps/web test
    npm --prefix apps/web run typecheck
    npm --prefix apps/web run build
