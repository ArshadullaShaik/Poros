# Vercel + persistent free-tier backend

The website runs on Vercel. All `/api/*` requests stream to the persistent Node API over HTTPS with a server-only shared secret. The backend checks that secret and the exact website origin before dispatching requests. Wallet proof text, signatures, and membership authorizations keep the website's original origin. Client IP limits use Vercel's trusted forwarded IP after proxy authentication.

The backend server runs the API, membership worker, Bee light node, and Caddy. This Compose file uses **Linux host networking**: only Caddy serves public HTTPS; Node listens on `127.0.0.1:8080` and Bee API on `127.0.0.1:1633`. SQLite, Bee data, and TLS certificates persist outside containers. Do not expose ports 8080 or 1633.

## Railway trial alternative

For a cloud-only no-card demo, `railway.json` builds the same Docker image. Run one replica with one 500 MB volume mounted at `/state`; set `HOST=0.0.0.0`, `POROS_BUNDLED_SERVICES=1`, `RAILWAY_RUN_UID=0`, `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS=0`, and `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`. Bee stays loopback; its data is `/state/bee`, its password file `/state/bee-password`, and membership custody `/state/membership.sqlite`.

The API serves health while waiting for `/state/.poros-ready`. Restore and verify existing data before writing that marker, and stop local writers/Bee before snapshotting. Upload files via the authenticated Railway volume CLI, then restart once restoration is complete. The central worker waits for Bee readiness and a usable postage batch before attempting publications. Do not initialize replacements for existing identities or custody.

Railway advertises a no-card trial, but account eligibility restrictions can still block deployment. The current account's backend deployment was refused with an unusual-activity restriction requiring payment verification; no migration or upgrade was performed. Resolve the restriction with Railway before attempting deployment again. Trial credits and data retention are limited. `railway.json` is accepted today but the CLI warns that legacy Config as Code is retired on 2026-12-01; migrate the config before later redeployments.

## Optional Oracle free server

Create an Oracle Cloud Free Tier account and an **Always Free eligible** Ubuntu 24.04 Ampere A1 VM in its home region. Current new-account allowance is 2 OCPUs / 12 GB RAM total and 200 GB combined boot/block storage; choose a 50 GB boot disk. Verify the Always Free allocation in your console, without upgrading to a paid account. Availability depends on region. Oracle can reclaim idle free instances, so keep custody and Bee backups separately.

Allow SSH only from your IP, and TCP 80/443 for HTTPS. Bee uses TCP/UDP 1634. Install Docker Engine and its Compose plugin from Docker's official Ubuntu instructions. Use an HTTPS backend hostname pointing at the VM. The account verification and SSH access must be completed before deployment can continue.

## Migrate the existing installation

Do this during a coordinated cutover after the server is reachable:

1. Stop new writes and the local membership worker before copying its state. Never run the same relay wallet against two independent SQLite copies.
2. Take a consistent SQLite backup using Node's `node:sqlite` backup API or SQLite's `.backup`; transfer it over SSH to `deploy/state/membership.sqlite`. Preserve **the same** `MEMBERSHIP_MASTER_KEY` and `MEMBERSHIP_RELAY_PRIVATE_KEY`. Do not initialize an empty replacement database.
3. Stop Swarm Desktop before backing up its complete Bee data directory. Transfer that directory to `deploy/bee-data`, and its matching password to `deploy/bee-password` over SSH. The stamp belongs to this Bee identity: starting a fresh node does not recover the existing stamp. Do not run both copies of the Bee identity simultaneously.
4. Copy `backend.env.example` to `deploy/.env` on the server and fill its values securely. Set `MEMBERSHIP_ORIGIN` to the stable production Vercel origin and `BACKEND_HOST` to the backend hostname (without `https://`). Generate a random 32-byte proxy secret, represented as 64 hex characters. Copy the existing postage batch and Arkiv configuration. Copy `bee.env.example` to `bee.env` and retain the old node's blockchain endpoint.
5. Set ownership of `state`, `bee-data`, and `bee-password` to UID/GID 1000; use mode 0700 for state directories and 0600 for `.env`, `bee.env`, and `bee-password`.
6. From `deploy`, run `docker compose build` then `docker compose up -d`. Check `docker compose logs --tail=50 api membership-worker bee` without sharing secrets. The public `/healthz` endpoint checks API availability; the authenticated member-content readiness request checks worker funding/readiness.

The trade recording worker is separate. If it is configured in the local installation, migrate its SQLite state and writer configuration separately before enabling live trade recording on the cloud host. Do not share its signing wallet with the membership relay.

## Vercel

Use the free Hobby scope. Create/link the project from the **repository root**, with project Root Directory `apps/web`, framework Next.js, Node 24, and **Include source files outside of Root Directory** enabled. `apps/web/vercel.json` installs both dependency trees and builds the app. Deploying only the `apps/web` folder omits the shared source.

Set only these backend connection secrets on Vercel:

- `POROS_BACKEND_URL`: exact HTTPS backend origin, without a path.
- `POROS_PROXY_SECRET`: same secret as the backend.

Do not upload the custody database, membership master key, relay private key, Bee password, or root `.env.local` to Vercel. The ignore files exclude local state and credentials. A Vercel deployment without a backend URL returns a clear 503 for APIs rather than pretending membership is available.

Deploy a preview first, check `/`, `/community`, and `/profile`, then connect the backend and verify same-origin RPC, membership readiness, one signed read of an existing eligible post, and a publication/purchase only with the user's live test approval. Finally promote the verified deployment to the stable production domain. Preview domains are not authorized by a backend configured for the production origin.

## Sources

- Oracle allocation and capacity: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Swarm Docker: https://docs.ethswarm.org/docs/bee/installation/docker/
- Swarm backups: https://docs.ethswarm.org/docs/bee/working-with-bee/backups/
- Docker Ubuntu installation: https://docs.docker.com/engine/install/ubuntu/
- Vercel monorepos: https://vercel.com/docs/monorepos/monorepo-faq
