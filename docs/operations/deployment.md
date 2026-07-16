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
fixture verification remains an ingestion-change lane because its external test cache is
intentionally not copied to CI or the production host.

Startup is ordered:

1. The workflow stops the current worker before the migration-bearing Compose start.
2. PostgreSQL becomes healthy.
3. The one-shot Drizzle migration exits successfully.
4. The API and credential-scoped new worker become healthy.
5. Caddy serves the built website and proxies `/api/*` to the API.

PRD-77 has one manual pre-merge cutover because production still has the migration-0010 schema and
roughly 45 GiB of obsolete derived PostgreSQL state plus 37.9 GiB of raw objects. After the exact
candidate is independently reviewed and its PR checks pass, but before merge:

1. Materialize the reviewed 40-character candidate SHA in a detached worktree, verify its exact
   `HEAD`, copy the mastered ignored `.env` at mode `0600` without printing it, build that candidate,
   and stop the current worker. The script reads and requires only `TMTURTLE_WEB_PORT`,
   `TMTURTLE_API_PORT`, and `CLERK_AUTHORIZED_PARTIES` from that file without sourcing it, then
   exports them with `COMPOSE_PROJECT_NAME=tmturtle`. The normal `main` deployment checkout remains
   untouched.
2. Let the checked cutover script build and stop the candidate worker, then run the offline rebuild.
   The command must report no durable corpus/publication, the exact count of discarded `created` or
   `retry` reconciliation wakeups, lower `source_record` and `source_claim` physical sizes after
   `TRUNCATE`, and one-at-a-time deletion of every catalogued or orphaned finalized object. Any
   `active` reconciliation delivery refuses the cutover. It leaves the worker stopped.
3. Accept zero files/zero bytes in `artifact-data`; zero `source_record`/`source_claim` rows;
   near-empty physical sizes for both relations; preserved account/API-key/catalog/quarantine rows;
   pending official discoveries; and unchanged migration count through 0010. The preflight
   intentionally leaves stale non-null object pointers because migration 0010 still requires them.
   A successful sweep writes the one-time PRD-77 proof only after database cleanup, every sequential
   raw unlink, and exact tracer retirement finish.
4. Merge only after those checks. Do not start the worker between preflight and merge.

```sh
(
  set -eu
  candidate_sha='<reviewed-40-character-commit-sha>'
  main_checkout=/Users/zknicker/srv/tmturtle
  master_env=/Users/zknicker/srv/tmturtle/.env
  runner=$(mktemp)
  trap 'rm -f "$runner"' EXIT HUP INT TERM

  git -C "$main_checkout" fetch --prune origin
  git -C "$main_checkout" show "${candidate_sha}:scripts/prd77-premerge-cutover" > "$runner"
  chmod 0700 "$runner"
  "$runner" "$candidate_sha" "$main_checkout" "$master_env"
)
```

Cutover capacity acceptance uses the recovered live baseline and explicit bounds:

| Measure | Before preflight | Required after preflight, before merge |
| --- | ---: | ---: |
| Colima free space | 93.1 GiB | at least 150 GiB |
| `artifact-data` regular files / payload | 738 / 37.9 GiB | 0 / 0 bytes |
| PostgreSQL database | 45 GiB | less than 5 GiB logical database size |
| `source_record` | 7,054,012 rows / 28 GiB relation | 0 rows / less than 16 MiB total relation size |
| `source_claim` | 17 GiB relation | 0 rows / less than 16 MiB total relation size |
| `parse_run` | 182 rows | zero non-quarantined rows; quarantine evidence preserved |

All artifact-version rows except the exact retired tracer remain with their SHA-256, byte count,
and discovery provenance. API keys, accounts, roles, migration history, product/artifact catalog,
source attempts/alerts, and quarantine evidence retain their preflight counts. The preflight result's
`artifactObjectsRemoved` is the number of unique catalogued and orphaned finalized keys removed;
`orphanArtifactObjectsRemoved` identifies the unreferenced subset. `artifactBytesRemoved` is the
catalog-known byte total because orphan byte content is not read during the sweep. The reported
post-`TRUNCATE` relation sizes and final zero-file volume inspection must satisfy the table above.

The ordinary deployment workflow then runs unchanged. Landed migration
`0011_retire_prd60_tracer` is cheap against the already-empty derived state. Migration 0012 refuses
a populated database without the exact completed-cutover proof, drops the `object_key` NOT NULL
constraint, clears the stale pointers, and removes the one-time proof. Fresh empty databases migrate
without a proof. The normal Compose dependency
graph starts the new worker only after both migrations succeed. Reconciliation then downloads,
validates, persists, and removes one artifact at a time; the exact 91-member annual set is
publication completeness metadata only. Later deployments do not repeat the manual cutover. Do
not roll back across it to a pre-PRD-77 worker or tracer-bearing runtime; deploy a corrected
PRD-77-or-later revision instead. After the merged deployment is accepted, remove the detached
candidate worktree from `main_checkout`; do not switch or rewrite the normal deployment checkout for
the pre-merge cutover.

The ignored production `.env` is mastered at `/Users/zknicker/srv/tmturtle/.env`, copied into the detached candidate without echoing values, and kept at mode `0600`. Required secret-bearing names are `DATABASE_URL`, `POSTGRES_PASSWORD`, `CLERK_SECRET_KEY`, and `USPTO_API_KEY`; `VITE_CLERK_PUBLISHABLE_KEY` supplies the approved shared MerchBase Clerk frontend configuration. Production sets `CLERK_AUTHORIZED_PARTIES` to exactly `https://tmturtle.merchbase.co`.

PostgreSQL and the transient artifact working directory use named volumes. API, worker, database, and Caddy use restart policies compatible with the host's existing Colima launch-on-boot service. Migration remains a successful one-shot container. Resource limits reserve the host from runaway ingestion while leaving PostgreSQL and authenticated reads independently observable.

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

Rollback is one exact-image rebuild from a known good Git revision. Named database and transient-working-data volumes remain attached.

```bash
git switch --detach <known-good-sha>
export TMTURTLE_REVISION="$(git rev-parse HEAD)"
docker compose --project-name tmturtle --env-file .env build
docker compose --project-name tmturtle --env-file .env up --detach --remove-orphans --wait
./scripts/deployment-smoke
```

After the bad revision is corrected, return the host checkout to `main`, fast-forward, and run the same build, up, and smoke sequence. Do not delete volumes as part of rollback.
