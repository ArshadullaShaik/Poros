# AI development prompts and contribution record

Poros was developed with assistance from OpenAI Codex. The team supplied the product direction, reviewed the proposed flows, selected integrations and deployment infrastructure, and tested the application with wallets. Codex assisted with implementation, debugging, tests, deployment configuration, and documentation.

This document records selected original user prompts recovered from the project's saved development conversations. Quotations retain the original wording. The context and implementation references are editorial summaries prepared for this submission; they are not additional historical prompts or claims that every proposed feature shipped.

## Recorded development prompts

### 1. Evaluate Swarm for exclusive member content

> go through my codebase can i implement a server as swarm (ethswarm.org)

**Direction:** Review the existing application before choosing how Swarm should support creator content.

**Resulting work:** Separate encrypted content storage from public membership and publication records. See [Swarm integration](arkiv/swarm.md) and the [content service](src/features/builder/server/member-content.ts).

### 2. Plan the membership integration

> lets make a bug fix plan and also how we can integrate the swarm feature in this project

**Direction:** Address the membership flow and plan the storage integration together.

**Resulting work:** Publication validation, encrypted uploads, content read-back, and wallet-authenticated delivery. [Pointer validation](src/integrations/arkiv/community/member-content.ts) · [Membership access checks](src/integrations/arkiv/community/memberships.ts)

### 3. Keep the interface focused

> implement the plan dont add any extra headache ui

**Direction:** Implement the agreed flow without adding unnecessary interface steps.

**Resulting work:** Creator publication and subscriber access are integrated with the existing membership interface. [Creator membership interface](apps/web/src/creator-membership.ts)

### 4. Reduce repeated wallet interactions

> why do i need to signin these many transactions to purchase a single membership lets make the buy sell of the membership in arkiv rabdi testnet itself and mnimize these many transactions needed to purchase a singke membership (automate things)

**Direction:** Use Rabdi for new membership payments and automate verification where possible.

**Resulting work:** Payment verification and relay activation run in the backend worker. Wallet approval, eligibility checks, and recovery remain part of the flow. [Membership relay](src/features/builder/server/membership-relay.ts) · [Runtime documentation](apps/web/README.md#creator-memberships)

### 5. Simplify private strategy publication

> carry on and also to post a private statergy too it takes lot of sign check and make it also easy

**Direction:** Reduce repeated signing during creator publication.

**Resulting work:** A creator authorizes the exact publication with a signature; the relay handles upload and the Arkiv pointer write. [Signed publication API](src/features/builder/server/member-content-api.mjs) · [Authorization verification](src/integrations/arkiv/community/membership-intent.ts)

### 6. Preserve the intended storage architecture

> why are we moving the membership data to render when our idea is to use on swarm

**Direction:** Keep the storage and hosting responsibilities explicit.

**Resulting work:** Swarm stores encrypted message content; Arkiv stores public records; the persistent backend checks eligibility and retains protected delivery state. The active backend runs on AWS EC2. [Architecture and evidence](arkiv/swarm.md)

### 7. Explain the integration accurately

> how are we using swarm and vs how are we using arkiv

**Direction:** Explain each technology's actual role for the submission and demo.

**Resulting work:** [Arkiv integration](arkiv/how-you-use-arkiv.md), [schema](arkiv/schema.md), and [Swarm integration](arkiv/swarm.md) describe the implementation and its limits.

## Human review and implementation boundaries

The prompts above show how the team directed part of the development process. They do not establish that every generated change was correct or that every integration was live-tested. Repository tests, deployment checks, and the recorded demo provide separate evidence. Proposed functionality is distinguished from implemented functionality in the [submission checklist](SUBMISSION.md), including the outstanding Definitive advanced-order requirement.

No credentials, private messages, private keys, or full encrypted Swarm references are included here. Infrastructure access details have been omitted from the selected excerpts.

## Teammate contributions

Additional contributors will append their own original prompts below. For each entry, record the contributor, AI tool, original prompt, the decision it supported, and the relevant files or commits. Mark paraphrases as summaries. Do not present a newly written prompt as a historical conversation.

```markdown
### [Contributor] — [Development task]

Tool: [AI tool used]
Date or development session: [If known]

Original prompt:
> [Paste the original prompt, removing credentials and private data.]

Context and outcome: [Explain what was requested and what was actually implemented.]
Implementation: [Relative file links or commit links.]
```

## Disclosure status

This is a curated record, not the complete team prompt history. Teammate entries and the original planning/specification artifacts still need review and inclusion before the team claims complete workflow disclosure. The local `docs/` directory contains development plans and specifications but is currently excluded from Git; this document does not replace those originals. The [ETHGlobal rules](https://ethglobal.com/events/mumbai/info/details) require prompts, specs, and planning artifacts when a spec-driven workflow is used.
