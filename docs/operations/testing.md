---
summary: Defines Trademark Turtle verification lanes for lint, types, units, PostgreSQL, fixtures, migrations, browser behavior, and production-shaped runtime.
read_when:
  - choosing checks for a server, ingestion, search, client, CLI, website, migration, or deployment change
  - diagnosing failing CI, fixtures, PostgreSQL integration, or browser acceptance
---

# Testing

Choose the smallest lane that proves the change while developing. Run the full
proportional set once after the diff is frozen.

## Common Lanes

| Change | Required evidence |
| --- | --- |
| Auth, services, pure parsers | Focused unit tests, touched lint, typecheck. |
| Persistence or ingestion | Focused real-PostgreSQL test, restart/idempotency/cleanup coverage. |
| Search or reports | Real PostgreSQL filters, sort, count, page, Data Version, and index plans. |
| HTTP client or CLI | Router/client build plus JSON-envelope and boundary tests. |
| Website | Focused tests plus one real happy path and riskiest adjacent path. |
| Schema | Generated migration review, upgrade/idempotency test, drift check. |
| Deployment | Isolated Compose health and deployment contract. |

## Commands

```bash
bun run lint -- <touched-authored-paths...>
bun run typecheck
bun run test
bun run build
bun run docs:list
```

Disposable PostgreSQL:

```bash
bun run test:integration:compose
```

The harness creates a unique Compose project and removes its containers,
network, and temporary database at exit. To use an already isolated database:

```bash
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/tmturtle_test \
  bun run test:integration
```

The selected database must be disposable.

## USPTO Fixtures

```bash
bun run fixtures:verify
bun run test:fixtures
```

Parser changes require byte-exact real XML records with source, action, and
physical-index context. Never generate a fixture from parsed database rows.
Full retained ZIPs remain outside Git.

Ingestion coverage includes:

- one provider request followed by parse-only replay;
- restart adoption and blocked incomplete downloads;
- complete-document validation before writes;
- fixed-batch application and Data Version updates;
- precedence, idempotency, unresolved records, and cleanup;
- source failure isolation and system fail-closed behavior;
- per-file repair without hiding existing data.

## Migrations

Generate from `apps/server/src/db/schema.ts`:

```bash
bun run db:generate
git diff -- apps/server/drizzle
```

Never hand-edit snapshots or rewrite landed migration history. CI reruns
generation and fails on drift.

## Browser Acceptance

User-facing changes use the repository app-verification workflow. Verify one
real authenticated happy path, the riskiest adjacent failure or navigation path,
and cleanup of smoke state. A component test alone does not prove routing,
Clerk, API, or browser behavior.

## CI

Pull requests run frozen install, changed-file lint, check, build, fixture-tool
tests, migration drift, and production-shaped PostgreSQL integration on a
GitHub-hosted runner.
