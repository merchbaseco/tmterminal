---
summary: Defines Trademark Terminal verification lanes for lint, types, units, PostgreSQL, fixtures, migrations, browser behavior, and production-shaped runtime.
read_when:
  - choosing checks for a server, ingestion, search, client, CLI, website, migration, or deployment change
  - diagnosing failing CI, fixtures, PostgreSQL integration, or browser acceptance
  - changing the Quality workflow, the `check` scripts, or which lanes run on every commit
---

# Testing

Choose the smallest lane that proves the change while developing. Run the full
proportional set once after the diff is frozen.

## Common Lanes

| Change | Required evidence |
| --- | --- |
| Auth, services, pure parsers | Focused unit tests, touched lint, typecheck. |
| Persistence or ingestion | Focused real-PostgreSQL test, restart/idempotency/cleanup coverage. |
| Search, matching, or screening | Real PostgreSQL filters, sort, count, page, batching, Data Version, and index plans. |
| HTTP client or CLI | Router/client build plus JSON-envelope and boundary tests. |
| Hosted MCP | SDK in-memory tool tests, Fastify OAuth/transport tests, and exact Caddy route coverage. |
| Website | Focused tests plus one real happy path and riskiest adjacent path. |
| Schema | Generated migration review, upgrade/idempotency test, drift check. |
| Deployment | Isolated Compose health and deployment contract. |

## Commands

```bash
bun run lint -- <touched-authored-paths...>
bun run typecheck
bun run test
bun run check:fast
bun run check
bun run build
```

Disposable PostgreSQL:

```bash
bun run test:integration:compose
```

The harness creates a unique Compose project and removes its containers,
network, and temporary database at exit. To use an already isolated database:

```bash
TMTERMINAL_TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5437/tmterminal_test \
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

### Quality is the fast lane, on purpose

`bun run check` is split, and the split is deliberate — preserve it.

`bun run check:fast` is the polite lane: `env:check`, `env:contract`,
`typecheck`, and `test`. `bun run check` is `check:fast` plus the heavy lanes —
`test:fixtures`, `test:integration:compose`, and `build`. Total coverage is
unchanged; the heavy lanes simply stop running on every commit.

| Trigger | What runs |
| --- | --- |
| Push to `main`, pull request | Frozen install, changed-file lint, `check:fast`, migration drift. Target: under a minute. |
| Deploy dispatch | The same fast job, plus a `full` job running `bun run check` — fixture tooling, Compose PostgreSQL integration, and every workspace build. |
| Local, before pushing | `bun run check`. |

The `full` job keys off `lint-base`, a required `workflow_call` input, so it is
non-empty exactly when Deploy called the workflow. The Compose integration lane
alone cost more than a minute per commit because it builds images and boots
Compose; it now gates the thing that actually ships instead of every push.
Builds stay out of the fast lane because the deploy path builds the images for
real and is the build's proof.

This shape is fleet-wide, not a Trademark Terminal quirk: Quality answers one
question per push — is the contract intact and does the fast stuff pass? — in
under about sixty seconds, with installs capped at `timeout-minutes: 5` and a
concurrency group that cancels in progress. Application builds, browser and GPU
tests, golden corpora, database simulations, and licensed or heavyweight
downloads belong to full `check` instead. Treat that division as the standard
when editing the Quality workflow.
