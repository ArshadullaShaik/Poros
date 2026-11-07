# Poros — Definitive

**Track:** Best Use of Flash Advanced Orders in a Social App

**Status:** incomplete. Current adapters submit market orders, not qualifying Flash advanced orders.

[Live app](https://poros-theta.vercel.app/) · [Repository](https://github.com/ArshadullaShaik/Poros) · [Setup](../README.md#run-locally) · [Requirements](https://ethglobal.com/events/mumbai/prizes/definitive)

## Social trading flow

| Step | Current behavior |
|---|---|
| Discover | Browse community strategies and creators. |
| Review | Import a published graph or interpret a written post, then inspect its canvas rules. |
| Authorize | Approve the required wallet actions; validate network, recipient, amount, quote, and signing data. |
| Execute | Local monitoring checks the condition and submits a Flash **market** order. |
| Inspect | Follow order status and available execution history, separately from paper results. |

Reading a post, importing a strategy, or subscribing to a creator never authorizes copy trading.

## Code and limits

| Area | Source and tests |
|---|---|
| EVM submission and signing checks | [Flash orders](../src/features/builder/execution/flash-orders.ts), [tests](../tests/dev3/flash-wallet.test.ts) |
| Solana submission | [Adapter](../src/features/builder/execution/solana-orders.ts), [tests](../tests/dev3/solana-orders.test.ts) |
| Local monitoring | [Monitor](../src/features/builder/execution/monitor.ts), [tests](../tests/dev3/price-monitor.test.ts) |
| Community handoff | [Controller](../src/features/builder/demo/community.js), [tests](../tests/dev3/text-live-flow.test.ts) |

Both adapters use `orderType: "market"`. Local price triggers are not provider-managed Limit, DCA, Stop, Take Profit, or TWAP orders. Unexpected types and brackets are rejected. Supporting an advanced order requires implementation, not relabelling.

Unknown submission outcomes are not automatically retried. Stopping local monitoring does not cancel an accepted Flash order.

## Qualification evidence

| Requirement | Status |
|---|---|
| Working social application | [Deployment](https://poros-theta.vercel.app/); team reports successful testing. |
| Genuine Flash advanced-order flow | **Pending implementation.** |
| Actual advanced order ID, type, network, and final status | **Pending.** Fixture values do not count. |
| Onchain execution and Explorer link shown in demo | **Pending.** Acceptance or paper fills are insufficient. |
| Short product video on X tagging `@DefinitiveFi` | **Pending public post URL.** |

Record a shared 2–under-3-minute demo: discover an idea, interpret and review it, authorize a genuine advanced order, then show its execution. Until that flow is implemented and verified, the current app is a product preview for this track, not a completed qualifying demo.
