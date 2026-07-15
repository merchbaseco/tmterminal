---
summary: Defines the one supported Mac mini production deployment, verification, monitoring hook, and rollback path.
read_when:
  - deploying or diagnosing Trademark Turtle on the Mac mini, Cloudflare Tunnel, production Compose, restart persistence, or rollback
  - changing the deployment workflow, production ports, image revision labels, resource limits, or deployment smoke checks
---

# Mac mini deployment

Trademark Turtle runs from `/Users/zknicker/srv/tmturtle` as Compose project `tmturtle`. Cloudflare Tunnel terminates public TLS for `https://tmturtle.merchbase.co` and forwards that hostname to Caddy on `http://127.0.0.1:8095`. The direct API diagnostic port is `127.0.0.1:3095`. No container binds a non-loopback host port.

## Deployment contract

The host checkout stays on `main`. A push to `main` runs `.github/workflows/deploy.yml` on the existing self-hosted runner. The workflow fast-forwards the host checkout, refuses tracked or untracked checkout changes, requires `HEAD` to equal both `origin/main` and the workflow's expected Git revision, labels both production images with that revision, builds, starts the stack, and runs `scripts/deployment-smoke`.

Startup is ordered:

1. PostgreSQL becomes healthy.
2. The one-shot Drizzle migration exits successfully.
3. The one-shot PRD-60 tracer retains the committed real fixture in the artifact volume, stages it through source observations, canonicalizes it, and replaces the canonical mark through the repository interface only while no durable corpus publication owns canonical state.
4. The API and credential-scoped worker become healthy.
5. Caddy serves the built website and proxies `/api/*` to the API.

The tracer step is deliberately fixture-specific. It is not a seed format or corpus publisher. Its canonical write shares the corpus publication lock and becomes a no-op after publication ownership begins. Complete-generation eligibility and atomic corpus publication remain outside PRD-61.

The ignored deployment `.env` is copied from the mastered `/Users/zknicker/Programming/tmturtle/.env` without echoing values and is mode `0600`. Required secret-bearing names are `DATABASE_URL`, `POSTGRES_PASSWORD`, `CLERK_SECRET_KEY`, and `USPTO_API_KEY`; `VITE_CLERK_PUBLISHABLE_KEY` supplies the approved shared MerchBase Clerk frontend configuration. Production sets `CLERK_AUTHORIZED_PARTIES` to exactly `https://tmturtle.merchbase.co`.

PostgreSQL and retained artifacts use named volumes. API, worker, database, and Caddy use restart policies compatible with the host's existing Colima launch-on-boot service. Migration and tracer remain successful one-shot containers. Resource limits reserve the host from runaway ingestion while leaving PostgreSQL and authenticated reads independently observable.

## Verification and monitoring hook

`scripts/deployment-smoke` is the external readiness and capacity hook. Worker readiness begins only after the current process completes its first scheduler reconciliation; its startup grace matches the existing 15-minute provider request bound, persisted backoff remains valid, and a stopped lane fails smoke. The hook also fails when either the PostgreSQL or artifact volume filesystem has less than 20 GiB free, migration or tracer failed, another long-running service is unhealthy, a bounded loopback or public HTTPS probe fails, or image labels do not match the deployed revision.

The anonymous readiness response is exactly `{"status":"ready"}` and contains no corpus data. Provider pacing, persisted backoff, retry caps, and serial initial downloads remain worker-owned. Corpus-through freshness does not exist until the separate corpus-publication work lands; this deployment does not invent a PRD-64 freshness signal.

For an explicit smoke or post-restart check:

```bash
cd /Users/zknicker/srv/tmturtle
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
./scripts/deployment-smoke
```

## Rollback

Rollback is one exact-image rebuild from a known good Git revision. Named database and artifact volumes remain attached.

```bash
git switch --detach <known-good-sha>
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
docker compose --project-name tmturtle --env-file .env build
docker compose --project-name tmturtle --env-file .env up --detach --remove-orphans --wait
./scripts/deployment-smoke
```

After the bad revision is corrected, return the host checkout to `main`, fast-forward, and run the same build, up, and smoke sequence. Do not delete volumes as part of rollback.
