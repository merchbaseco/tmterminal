---
summary: Defines the approval-gated final centralized-auth cleanup, preservation checks, deployment, and recovery.
read_when:
  - preparing or executing the Trademark Terminal centralized-auth schema cleanup
  - reviewing stable account mappings, legacy dependency evidence, production backup, migration, or recovery
---

# Centralized-Auth Cleanup

Production migration and deployment require separate operator approval. The
Deploy workflow's `auth-cleanup-approved` confirmation means every gate below is
complete; it is not a substitute for the evidence.

## Cleanup Gates

Before approving the cleanup:

- confirm every account has one unique, reviewed stable Merchbase User mapping;
- confirm current runtime and published clients use only Clerk sessions,
  suite-wide User API Keys, or OAuth;
- obtain legacy credential owner and customer acceptance that no external
  consumer still depends on product-specific authentication;
- record account, preference, role, mark, source-artifact, projection, and
  projection-receipt counts or hashes without customer identifiers;
- identify the exact approved revision and production operators.

A retained active credential row is migration evidence, not proof of current
use. Repository searches and historical usage timestamps are negative evidence
only. Missing external-consumer acceptance stops the cleanup.

From the production checkout, run the sanitized invariant check and capture the
preservation fingerprint:

```bash
cd /Users/zknicker/srv/tmterminal
./scripts/auth-cleanup-inventory verify-pre
./scripts/auth-cleanup-inventory capture
```

Both commands use a read-only transaction and print counts or irreversible
aggregate hashes only. They never print account IDs, Clerk subjects, emails,
credentials, or credential hashes. Save their output with the approval record
outside the checkout.

## Backup And Restore Proof

Choose a timestamped destination on a different durable filesystem and record
its exact path:

```bash
backup_dir=/Users/zknicker/srv/tmterminal-backups/<UTC-timestamp>
install -d -m 700 "$backup_dir"
docker compose --project-name tmterminal --env-file .env exec -T database \
  sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --format=custom --no-owner' >"$backup_dir/tmterminal.dump"
shasum -a 256 "$backup_dir/tmterminal.dump" >"$backup_dir/tmterminal.dump.sha256"
test -s "$backup_dir/tmterminal.dump"
shasum -a 256 -c "$backup_dir/tmterminal.dump.sha256"
```

Restore the dump into an isolated PostgreSQL 16 database. Verify the recorded
counts and hashes there, run the approved migration twice, then verify:

- account, preference, role, mark, source, and projection data are unchanged;
- every account mapping is non-null and unique;
- the legacy identity and product-specific credential tables are absent;
- a second migration run is a no-op.

Never use production as the restore target. Record the dump checksum, isolated
target, migration result, preservation result, and approver without customer
identifiers.

Against the isolated restore, point the same checks at its explicit connection
URL:

```bash
AUTH_CLEANUP_DATABASE_URL="<isolated-restore-url>" \
  ./scripts/auth-cleanup-inventory verify-pre
preservation_before="$(
  AUTH_CLEANUP_DATABASE_URL="<isolated-restore-url>" \
    ./scripts/auth-cleanup-inventory capture
)"
DATABASE_URL="<isolated-restore-url>" bun run db:migrate
DATABASE_URL="<isolated-restore-url>" bun run db:migrate
preservation_after="$(
  AUTH_CLEANUP_DATABASE_URL="<isolated-restore-url>" \
    ./scripts/auth-cleanup-inventory capture
)"
test "$preservation_before" = "$preservation_after"
AUTH_CLEANUP_DATABASE_URL="<isolated-restore-url>" \
  ./scripts/auth-cleanup-inventory verify-final
```

## Production Sequence

1. Prevent deployment concurrency and repeat the count-only preflight.
2. Obtain the dependency, backup/restore, migration, deploy, and cleanup
   approvals.
3. Dispatch the Deploy workflow for the exact approved `main` revision with
   `auth-cleanup-approved` confirmed.
4. The workflow builds the exact revision, stops the API and worker, captures
   the preservation fingerprint, and verifies the pre-migration invariant.
5. With writers still stopped, it runs the generated migration, requires an
   identical preservation fingerprint, and verifies the final schema.
6. Verify one dashboard session, one suite User API Key through `tt`, one OAuth
   request, one denied user, and one dependency-unavailable response.
7. Verify ordinary worker health, exact image revision labels, and the complete
   deployment smoke.

Do not delete or retire Clerk suite credentials as part of this workflow.
Retries and later deployments detect the final schema, verify its invariant,
and rerun migrations idempotently without requiring removed evidence tables.

## Failure And Recovery

The generated migration is transactional. If it rejects an unmapped account or
another invariant, the workflow leaves the API and worker stopped. Run
`verify-pre` and compare a fresh `capture` with the pre-migration fingerprint to
confirm that the prior schema and data remain, then restart the known compatible
centralized-auth revision. Do not partially apply the SQL or delete rows by
hand.

After a successful cleanup, an application rollback may use only a revision
explicitly verified against the final schema. Reversing the schema or recovering
the removed evidence requires stopping traffic and restoring the verified
pre-cleanup dump with explicit backup-operator approval. Verify the same counts
and hashes after restore; never reconstruct removed rows manually.
