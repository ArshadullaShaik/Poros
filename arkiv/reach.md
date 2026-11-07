# Reach

Poros serves traders who want to evaluate a creator's strategy history before following their advice or paying for membership. A feed of successful calls alone leaves out the failures that matter to that decision.

| Audience | Problem | Current workflow |
|---|---|---|
| Community traders | Posts are hard to turn into testable rules. | Open a published graph or interpret a written strategy, then review it. |
| Creators | Public discussion and member content are split across tools. | Publish strategies, offer a 30-day membership, and share exclusive messages. |
| People evaluating creators | Deleted failed calls can leave a misleading history. | Inspect retained strategy versions, revisions, and available trade records. |
| Developers | Community data is usually locked behind one product. | Query the same public Arkiv records from another client. |

## Try it

[Poros is deployed](https://poros-theta.vercel.app/). Browse [Communities](https://poros-theta.vercel.app/community), then open a published strategy in [Trade](https://poros-theta.vercel.app/).

Public browsing needs no wallet. Signed writes need Rabdi gas; new memberships use Rabdi tGLM. Written-strategy interpretation needs a user-provided 0G key and may cost money. Reviewing and backtesting an existing graph does not require a membership or trade approval.

The team reports successful deployment testing. Separate local checks passed 506 tests, with one funded-wallet test skipped. A read-only query on 7 November 2026 found one public strategy version and 21 social events. These are development records, not customer or adoption metrics.

## Why return?

Return to compare a revision, test a changed rule, follow a discussion, or read a creator's new message. Membership buys content access, not a promised return. Reading content never activates copy trading.

## After Mumbai

| Priority | Next step | Success measure |
|---|---|---|
| First-use experience | Improve guided creation and smaller-screen dragging. | A new tester imports and reviews a strategy without help. |
| Reliable access | Monitor relay jobs, Bee availability, backups, and recovery. | Interrupted purchases recover without duplicate payment. |
| Clear evidence | Improve expiry and report-coverage explanations. | Users distinguish missing history, paper results, and verified fills. |
| Larger communities | Revisit bounded scans and request coordination. | Feeds remain complete and responsive as records grow. |

These are proposed next steps, not delivery commitments. We have not measured repeat usage or product-market fit.

[Verification and setup](../README.md) · [Track criteria](https://ethglobal.com/events/mumbai/prizes/arkiv)
