# Why Arkiv

A trading screenshot shows an outcome. It rarely shows the rules behind it, who changed them, or which version someone actually tested.

Poros turns those ideas into strategies people can inspect, discuss, and build on. Arkiv gives each published version a wallet author, a checked content hash, and links to its revisions and forks. The strategy becomes a shared record, not just another post in a feed.

## Clear rules before execution

Users drag blocks onto a canvas to define price conditions, risk limits, and buy or sell actions. For written strategies, 0G inference helps translate the text into supported rules. The builder validates the result before presenting it for review.

The AI proposes. The user decides what to keep, change, or test. Publishing a strategy, importing it, and authorizing a trade are separate actions.

## Why a shared record matters

A community can open the exact version being discussed, compare a revision with its parent, or fork a strategy while preserving its source. Developers can query those same public records to build another client without relying on Poros's API.

A private database could store identical fields. Arkiv's value is independent access and native authorship metadata: readers can inspect the retained record themselves instead of relying solely on the history our website chooses to display.

Arkiv also holds community activity, membership records, and execution evidence from the configured trade writer. A stored strategy is not proof of profit, and a trade record does not establish that it followed a particular strategy without an execution link.

## Retention is explicit

Strategy and durable community records default to 180 days; chat defaults to 45 days. Communities support lifetime extensions, and the trade worker renews its evidence. Records can still expire or be deleted by their owners, so this is inspectable retained history, not a permanent or complete track record.

## Public strategies, private member content

Published strategies and community records belong on Arkiv. Exclusive messages and private strategy attachments stay encrypted on Swarm, with decryption material held by the backend. That delivery is operator-managed, not end-to-end encrypted.

Drafts and paper-run history stay in the browser. Credentials, recovery jobs, and market feeds stay outside the public record. Arkiv stores what the community needs to inspect, not every piece of application state.

## Where unused 0G credits fit

Our proposed next step, discussed with 0G developers, is to use a person's remaining daily compute allowance for agentic trading before it expires. With the user's permission, those credits would pay for inference; they are not trading capital or permission to move funds.

The [0G Pot](../apps/web/ZERO-G-POT.md) currently simulates credit donations and claims. Real credit reuse remains proposed. Arkiv's role in that future flow would be to make the associated strategy versions and run evidence inspectable, while 0G supplies the compute.

[How the integration works](how-you-use-arkiv.md) · [Record schema](schema.md) · [Query the public data](../README.md#verify-the-public-data)
