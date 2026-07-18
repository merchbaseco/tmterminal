---
summary: Defines the one supported Mac mini production deployment, verification, monitoring hook, and rollback path.
read_when:
  - deploying or diagnosing Trademark Turtle on the Mac mini, Cloudflare Tunnel, production Compose, restart persistence, or rollback
  - changing the deployment workflow, production ports, image revision labels, resource limits, or deployment smoke checks
---

# Mac mini deployment

Trademark Turtle runs from `/Users/zknicker/srv/tmturtle` as Compose project `tmturtle`. Cloudflare Tunnel terminates public TLS for `https://tmturtle.merchbase.co` and forwards that hostname to Caddy on `http://127.0.0.1:8095`. The direct API diagnostic port is `127.0.0.1:3095`; PostgreSQL is available on `127.0.0.1:5437` for the established Tailscale development path. No container binds a non-loopback host port.

## Deployment contract

The host checkout stays on `main`. A push to `main` first runs the reusable quality workflow on a
GitHub-hosted runner. Deployment starts on the existing self-hosted runner only after install,
changed-file lint, typecheck, tests, build, fixture tooling, migration drift, and production-shaped
PostgreSQL integration are green. The deployment then fast-forwards the host checkout, refuses
tracked or untracked checkout changes, requires `HEAD` to equal both `origin/main` and the
workflow's expected Git revision, labels both production images with that revision, builds, stops
the currently deployed worker, starts the stack, and runs `scripts/deployment-smoke`. Full
fixture verification remains an ingestion-change lane because its external test cache is
intentionally not copied to CI or the production host.

Startup is ordered:

1. Keep the current production worker stopped.
2. Back up PostgreSQL and record the exact deployed and candidate SHAs.
3. Fast-forward the clean production checkout to the reviewed merge SHA.
4. Build images labeled with that exact SHA.
5. Start PostgreSQL and run the one-shot Drizzle migrator. Its single transaction preserves live projected rows, all 91 annual artifacts, retained Part 26, provider state, accounts, identities, keys, and roles while removing generation keys and pointers.
6. Start API and Caddy; verify database/API/web readiness and auth/search behavior while the worker remains stopped.
7. Start the worker only after explicit deployment authorization. Its first database-derived action resumes retained Part 26 without another provider download. Verify one atomic live update, ZIP cleanup, and truthful `/ops/sync` state.

There is no pre-merge cutover script, compatibility view, dual write, or embedded rollback across the schema cutover. The one forward migration is deliberately pinned to the exact sole-build production shape. If migration or acceptance fails, leave the worker stopped and deploy a corrected revision against the restored backup.

The ignored production `.env` is mastered at `/Users/zknicker/srv/tmturtle/.env`, copied into the detached candidate without echoing values, and kept at mode `0600`. Required secret-bearing names are `DATABASE_URL`, `POSTGRES_PASSWORD`, `CLERK_SECRET_KEY`, and `USPTO_API_KEY`; `VITE_CLERK_PUBLISHABLE_KEY` supplies the approved shared MerchBase Clerk frontend configuration. Production sets `CLERK_AUTHORIZED_PARTIES` to exactly `https://tmturtle.merchbase.co`.

PostgreSQL and the transient artifact working directory use named volumes. API, worker, database, and Caddy use restart policies compatible with the host's existing Colima launch-on-boot service. Migration remains a successful one-shot container. Resource limits reserve the host from runaway ingestion while leaving PostgreSQL and authenticated reads independently observable.

## Verification and monitoring hook

`scripts/deployment-smoke` is the external readiness and capacity hook. Worker readiness begins only after the current process completes its first scheduler reconciliation; its startup grace matches the existing 15-minute provider request bound, persisted backoff remains valid, and a stopped lane fails smoke. The hook also fails when either the PostgreSQL or artifact volume filesystem has less than 20 GiB free, migration failed, another long-running service is unhealthy, a bounded loopback or public HTTPS probe fails, or image labels do not match the deployed revision.

The anonymous readiness response is exactly `{"status":"ready"}` and contains no trademark data. Readiness does not claim data completeness. The worker owns a fixed 10-second cadence, serial downloads, persisted backoff, and a non-configurable eight-attempt ceiling. Authenticated sync reports freshness and durable ingestion state; the operator page reports annual baseline progress, provider lane, and compact artifact state.

For an explicit smoke or post-restart check:

```bash
cd /Users/zknicker/srv/tmturtle
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
./scripts/deployment-smoke
```

## Rollback

After the direct-schema migration, recovery uses the PostgreSQL backup plus a corrected exact Git revision. Do not run a pre-cutover worker against the direct schema. Named database and transient-working-data volumes remain attached only when the selected revision owns their schema.

```bash
git switch --detach <corrected-post-cutover-sha>
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
docker compose --project-name tmturtle --env-file .env build
docker compose --project-name tmturtle --env-file .env up --detach --remove-orphans --wait
./scripts/deployment-smoke
```

After the bad revision is corrected, return the host checkout to `main`, fast-forward, and run the same build, up, and smoke sequence. Do not delete volumes as part of rollback.
