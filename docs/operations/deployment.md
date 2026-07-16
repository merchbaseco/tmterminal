---
summary: Defines the one supported Mac mini production deployment, verification, monitoring hook, and rollback path.
read_when:
  - deploying or diagnosing Trademark Turtle on the Mac mini, Cloudflare Tunnel, production Compose, restart persistence, or rollback
  - changing the deployment workflow, production ports, image revision labels, resource limits, or deployment smoke checks
---

# Mac mini deployment

Trademark Turtle runs from `/Users/zknicker/srv/tmturtle` as Compose project `tmturtle`. Cloudflare Tunnel terminates public TLS for `https://tmturtle.merchbase.co` and forwards that hostname to Caddy on `http://127.0.0.1:8095`. The direct API diagnostic port is `127.0.0.1:3095`. No container binds a non-loopback host port.

## Deployment contract

The host checkout stays on `main`. A push to `main` first runs the reusable quality workflow on a
GitHub-hosted runner. Deployment starts on the existing self-hosted runner only after install,
changed-file lint, typecheck, tests, build, fixture tooling, migration drift, and production-shaped
PostgreSQL integration are green. The deployment then fast-forwards the host checkout, refuses
tracked or untracked checkout changes, requires `HEAD` to equal both `origin/main` and the
workflow's expected Git revision, labels both production images with that revision, builds, stops
the currently deployed worker, starts the stack, and runs `scripts/deployment-smoke`. Full
retained-source verification remains an ingestion-change lane because its external byte cache is
intentionally not copied to CI or the production host.

Startup is ordered:

1. The workflow stops the current worker before the migration-bearing Compose start.
2. PostgreSQL becomes healthy.
3. The one-shot Drizzle migration exits successfully.
4. The API and credential-scoped new worker become healthy.
5. Caddy serves the built website and proxies `/api/*` to the API.

Migration `0011_retire_prd60_tracer` is the one-time Class 025 cutover. Under the corpus lock it
refuses an existing durable corpus or publication, removes the synthetic `60146682` canonical row
only when the exact PRD-60 tracer artifact identity exists, removes non-quarantined pre-v3 derived
parse state, and retires that tracer's catalog metadata. Official retained catalog/raw-object
references, unrelated canonical rows, and durable quarantine evidence remain; eligible official
versions return to `verified` for sequential v3 parsing. Drizzle records the transaction once;
later deployments do not repeat the cleanup. The normal Compose dependency graph starts the new
worker only after migration succeeds. Do not roll back across this cutover to a pre-PRD-77 worker
or tracer-bearing runtime; deploy a corrected PRD-77-or-later revision instead.

The ignored deployment `.env` is copied from the mastered `/Users/zknicker/Programming/tmturtle/.env` without echoing values and is mode `0600`. Required secret-bearing names are `DATABASE_URL`, `POSTGRES_PASSWORD`, `CLERK_SECRET_KEY`, and `USPTO_API_KEY`; `VITE_CLERK_PUBLISHABLE_KEY` supplies the approved shared MerchBase Clerk frontend configuration. Production sets `CLERK_AUTHORIZED_PARTIES` to exactly `https://tmturtle.merchbase.co`.

PostgreSQL and retained artifacts use named volumes. API, worker, database, and Caddy use restart policies compatible with the host's existing Colima launch-on-boot service. Migration remains a successful one-shot container. Resource limits reserve the host from runaway ingestion while leaving PostgreSQL and authenticated reads independently observable.

## Verification and monitoring hook

`scripts/deployment-smoke` is the external readiness and capacity hook. Worker readiness begins only after the current process completes its first scheduler reconciliation; its startup grace matches the existing 15-minute provider request bound, persisted backoff remains valid, and a stopped lane fails smoke. The hook also fails when either the PostgreSQL or artifact volume filesystem has less than 20 GiB free, migration failed, another long-running service is unhealthy, a bounded loopback or public HTTPS probe fails, or image labels do not match the deployed revision.

The anonymous readiness response is exactly `{"status":"ready"}` and contains no corpus data. Readiness does not claim corpus availability. Provider pacing, persisted backoff, retry caps, and serial downloads remain worker-owned. The authenticated sync contracts report durable corpus state; the operator page separately reports annual first-publication progress and retained-only daily state.

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
