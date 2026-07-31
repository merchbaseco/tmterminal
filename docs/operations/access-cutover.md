---
summary: Defines the approval-gated centralized-auth inventory, backup, explicit account mapping, cutover verification, cleanup, and rollback.
read_when:
  - preparing or executing the Trademark Terminal centralized-auth migration
  - reviewing account mappings, production backup, legacy-key retirement, cutover, or rollback
---

# Access Cutover

Production mapping, migration, deployment, Clerk mutation, legacy-key
retirement, and cleanup are separate operator approvals. A code review or normal
deployment approval does not authorize them.

The Deploy workflow is manual while this cutover is pending. Its
`centralized-auth-cutover-approved` confirmation means every approval and
preflight in this document is complete; it is not a substitute for them.

## Read-only Preflight

From the production checkout:

```bash
cd /Users/zknicker/srv/tmterminal
bun run access:inventory
```

The command starts a read-only transaction and prints counts only. Capture a
separate mode-0600 mapping review outside every checkout. It must contain one
row per local account, the authoritative Merchbase User assignment, evidence
source, and reviewer decision. Keep account IDs, Clerk subjects, emails, and
mapping evidence out of logs, tickets, commits, and chat. Never infer a mapping
from email. Any blank, duplicate, or ambiguous assignment stops the cutover.

Verify:

- every existing account appears exactly once;
- every assignment came from authoritative identity evidence;
- stable Merchbase User IDs are unique;
- trademark rows, search preferences, roles, and source state remain unchanged;
- the current count is used instead of a dated baseline.

## Backup Gate

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

Before cutover, restore that dump into an isolated PostgreSQL 16 database, run
the following approval-time procedure from the production checkout:

```bash
restore_container=tmterminal-restore-<UTC-timestamp>
restore_port=<unused-loopback-port>
restore_password=<ephemeral-restore-password>
pg_restore --list "$backup_dir/tmterminal.dump" >/dev/null
docker run --name "$restore_container" --detach \
  --publish "127.0.0.1:${restore_port}:5432" \
  --env POSTGRES_USER=tmterminal_restore \
  --env POSTGRES_PASSWORD="$restore_password" \
  --env POSTGRES_DB=tmterminal_restore \
  postgres:16.14-alpine
until docker exec "$restore_container" pg_isready \
  --username tmterminal_restore --dbname tmterminal_restore; do sleep 1; done
docker exec -i "$restore_container" pg_restore \
  --username tmterminal_restore --dbname tmterminal_restore \
  --clean --if-exists --no-owner <"$backup_dir/tmterminal.dump"
DATABASE_URL="postgres://tmterminal_restore:${restore_password}@127.0.0.1:${restore_port}/tmterminal_restore" \
  bun run --cwd apps/server access:inventory
docker stop "$restore_container"
docker rm "$restore_container"
```

Do not use the production database as the restore target. Run representative
account/preference/trademark count and hash queries inside the same read-only
restore session. Record the dump checksum, restore target, restore result, and
approver without customer identifiers.

## Approved Sequence

1. Prevent deployment concurrency and stop the API and worker so no request can
   resolve an unmapped existing user.
2. Capture and restore-test a fresh backup.
3. Build the approved revision and run only its one-shot additive migration.
   Do not start the new API or worker.
4. Apply the reviewed account-to-Merchbase-User artifact in one explicit
   transaction. Reject blanks and duplicates; do not create, merge, delete, or
   rename accounts.
5. Verify account count, mapping count, preference hashes, roles, trademark
   counts, and source state against the preflight.
6. Configure the Clerk verification and webhook secrets, then start the new API.
   Confirm signed create/update/delete,
   duplicate, and out-of-order behavior without customer data.
7. Verify one dashboard session, one suite API key through `tt`, one denied
   user, and one dependency-unavailable response.
8. Start the worker; verify daily projection repair and ordinary USPTO health.
9. Retire legacy keys through their owning systems only after customer
   acceptance. Runtime already rejects them; never print raw keys.
10. In a later release, generate the final migration to enforce
    `account.merchbase_user_id` not null and remove legacy auth tables only after
    every mapping and retirement is proven.

Required approvals: mapping reviewer, backup/restore operator, production
migration/deploy operator, Clerk/webhook operator, legacy-key retirement owner,
and final cleanup owner.

## Rollback

Before any legacy retirement or destructive cleanup, roll back code to the
known compatible revision while preserving the additive columns/tables and all
named volumes. Restore the prior webhook routing/configuration and run the
normal deployment smoke. Do not erase stable mappings or product data.

If an approved backfill was wrong, stop traffic and the worker, preserve the
failed state, and restore the verified pre-cutover dump to an isolated database
first. Production restore requires the backup operator's explicit approval,
documented target, and post-restore count/hash checks. A post-cleanup rollback
must restore the verified dump; do not reconstruct legacy auth rows manually.
