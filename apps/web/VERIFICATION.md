# Verification

Checked locally at `6fee655` on 7 November 2026.

| Check | Result |
|---|---|
| Arkiv tests | 79 passed; 1 funded-wallet test skipped. |
| Builder tests | 282 passed. |
| Web tests | 145 passed. |
| Production build and Arkiv typecheck | Passed. |
| Browser smoke checks | Home, Trade, Orders, Communities, Profile, Creator, Memberships, and mock Pot loaded. |
| Live reads | Public Arkiv records, creator prices, all 14 ticker quotes, and Orders chart loaded. |

Desktop canvas dragging worked; one smaller-window attempt added an unexpected block. Community expiry appeared as a block number.

The team reports successful deployment testing separately. This local run did not perform membership payments, live trades, paid inference, or Swarm uploads. A build or fixture test does not establish those live flows.

Run [the current checks](../../README.md#checks) after code changes. Build before the web suite, which reads generated Next assets.
