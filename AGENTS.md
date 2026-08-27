# Trademark Terminal Agent Guide

## Working model

- Run `bun run docs:list` at task start and read docs whose `Read when` hints match the work.
- Read `docs/product/README.md` before changing user-facing service, search, reports, source-status, or website behavior.
- Read `docs/internals/README.md` before changing architecture, persistence ownership, or ingestion.
- Read `docs/reference/README.md` before changing API, client, CLI, source, schema, state, or precedence contracts.
- Read `docs/operations/README.md` before changing development, verification, deployment, repair, or issue workflows.
- Read `docs/operations/source-repair.md` before inspecting or repairing a failed source file, replaying retained bytes, or authorizing another USPTO download request.
- Read `docs/design/system.md` before changing website primitives, styling, themes, or layout.
- Prefer the right end state. Do not add legacy aliases, compatibility shims, dual-write paths, or website features outside the v1 contract.
- Keep changes small and reviewable. Preserve unfamiliar work.
- Use Bun and the repository's pinned toolchain.
- Use Conventional Commit messages.
- Do not push unless explicitly asked.

## Product contract

- Trademark Terminal is an authenticated service with a thin search website for print-on-demand sellers.
- The service owns USPTO discovery, downloads, parsing, normalization, persistence, freshness, and search semantics.
- Callers learn the typed Trademark Terminal interface; they do not learn USPTO dataset or parser details.
- Every data procedure requires either a Clerk session or an API key. There are no anonymous data routes in v1.
- Exact serial and registration numbers are identities. Never treat them as fuzzy search terms.
- Apply filtering and sorting on the server before pagination and count.
- Source-artifact and data state are database-backed. Worker completion must be observable across processes.
- USPTO artifacts update perpetual live trademark tables in bounded transactions; ingestion progress never gates reads.
- Annual and daily are provider packaging, not separate application modes or query-visible datasets.
- Latest Processed and Needs Attention describe source currentness without implying that other database rows are unavailable.

## Code shape

- Target a Bun workspace with `apps/server`, `apps/web`, `packages/http-client`, and `packages/cli`.
- Keep the server and website apps private. Publish only the HTTP client and CLI.
- Keep SQL in query/repository modules; route modules call domain services.
- Derive client input/output types from the server router. Do not duplicate DTOs.
- Keep files cohesive, use kebab-case names, avoid barrel exports, and export only imported symbols.
- Test behavior through module interfaces using real PostgreSQL where persistence semantics matter.

## Code quality

- Keep TypeScript strictness and the repo-standard Ultracite/Biome configuration intact. Use
  `bun run lint` for the lint baseline and `bun run lint:fix` only on explicit quality-only paths.
- Build contracts and types before implementation details. Prefer inference from tRPC, Zod, and
  Drizzle; validate external input at boundaries; model states with narrow unions and exhaustive
  checks.
- Keep failures explicit and contextual. Do not swallow errors or add broad catches, fallback
  paths, speculative retries, compatibility branches, or defensive machinery outside the current
  contract.
- Keep hand-written production modules cohesive; target under roughly 300 lines and split when
  responsibilities diverge. Do not mechanically split generated code, COSS primitives, fixtures,
  or cohesive tests to satisfy a number.
- Keep the main export and core flow near the top and local helpers near the bottom. Prefer concrete
  product nouns over vague names such as `manager`, `helper`, or `data`.
- Keep transport routes thin: authenticate, validate, call domain logic, and return a narrow result.
  Keep SQL in query/repository modules and map database or external payloads explicitly at
  boundaries.
- Use the server and TanStack Query cache as data sources of truth. Derive React state during render;
  reserve effects for external synchronization; make cache, freshness, invalidation, and navigation
  persistence intentional.
- Prefer stock COSS UI primitives and existing dependencies. Do not customize or lint vendored COSS
  component internals. Add a dependency only for a current capability and pin it exactly.
- Treat `apps/server/src/db/schema.ts` as schema source of truth. Generate migrations with
  `bun run db:generate`; never hand-edit generated snapshots or rewrite, rename, or renumber landed
  migrations. Inspect generated diffs and verify upgrade/idempotency.
- Do not hand-edit generated output or byte-exact fixtures. Keep generated declarations, build
  output, Drizzle metadata, migration SQL, COSS internals, and retained fixture payloads narrowly
  excluded from formatting and linting.
- Test behavior through public or module interfaces. Choose the smallest lane that proves the
  change, mock only true external boundaries, use real PostgreSQL for persistence semantics, and
  avoid tests whose primary assertion is that a spy was called.
- Ordered provider, transaction, and ingestion loops stay sequential when the contract requires it;
  do not parallelize them merely to satisfy a lint rule.
- Operational failures must identify the operation and relevant artifact. Avoid
  heartbeat, retry, and per-row log noise.

## PRD closeout

Before any PRD commit, PR, merge, or closeout:

1. Inspect the whole diff against its current `origin/main` baseline.
2. Perform a simplification audit and remove unnecessary abstractions, fallback/retry/error
   branches, compatibility paths, duplicate state, and code outside the narrow contract.
3. Report what was removed and justify every remaining nontrivial branch or state surface.
4. Obtain orchestrator approval, then run an independent review.
5. Run lint for every touched authored path, then `bun run check` — the full set, not just
   `check:fast` — plus every applicable domain-specific verification lane. The Quality workflow
   deliberately runs only the fast lane per commit; read "Quality is the fast lane, on purpose"
   in `docs/operations/testing.md` before changing `.github/workflows/quality.yml` or the
   `check` / `check:fast` scripts.
6. Commit and ship only after review findings are resolved; close Linear and archive the Codex task
   only after deployment acceptance.

## Verification

- Parser changes require byte-exact real XML fixtures with source/action context.
- Ingestion changes require restart, idempotency, cleanup, source-coordinate, artifact-replay, live-visibility, and transaction coverage.
- Search changes require filter, sort, count, pagination, and index-use coverage.
- Client and CLI changes require contract generation/build plus JSON-envelope tests.
- Website changes require focused automated checks plus the `app-feature-verification` happy and adjacent paths.
- Deployment changes require local Compose health verification before release.

## Agent skills

### Issue tracker

Issues are tracked in Linear under the Products (`PRD`) team and routed with the `Trademark Terminal` label. See `docs/operations/issues.md`.

### Triage labels

The Linear Products team uses the canonical triage label vocabulary in `docs/operations/issues.md`.

### Domain docs

This is a single-context repository. Root `CONTEXT.md` owns the shared glossary; `docs/README.md` routes durable contracts and decisions.

### Product docs

Public seller docs live in `apps/docs` and ship at `/docs`. Write them with
the fleet `write-product-docs` skill, then run a `no-ai-slop` pass.
Maintainer docs stay in `docs/`.

## Cursor Cloud specific instructions

The Cloud Agent environment is defined by `.cursor/environment.json` (named
`Merchbase TMTerminal`) and the scripts beside it. It provisions Bun (pinned to
`packageManager`) and a system PostgreSQL 16 cluster, then runs the API and
website against that local database. Non-obvious points:

- There is no `.env` step anywhere. The committed `.env.schema` is the whole
  environment contract, and values resolve from 1Password through the fleet-wide
  Development identity Cursor injects as an account-scoped Runtime Secret. See
  [Environment](docs/operations/environment.md).
- The documented `bun run dev` and `./scripts/compose` are for a workstation:
  the schema's development arm points at the production database over Tailscale,
  and Compose needs Docker. Neither works in Cloud Agents. Use the local runtime
  instead: `.cursor/start.sh` (starts Postgres, applies migrations, and seeds
  synthetic development data) plus the `api` (`http://127.0.0.1:3000`) and
  `web` (`http://127.0.0.1:5173`, proxies `/api`) terminals.
- A cloud session therefore opens with a current week of fabricated trademark
  data already in the local database. `bun run db:seed:dev` refills it; it
  refuses any non-loopback database host and never calls the USPTO Open Data
  Portal. See [Development](docs/operations/development.md).
- The local cluster listens on the schema's development database port, so a
  cloud session overrides exactly one public value —
  `TMTERMINAL_DATABASE_HOST=127.0.0.1`. The role and password still resolve from
  the Development vault, so the local cluster is provisioned with the same
  credential the server will use.
- `bun install` needs two install-time credentials, `MERCHBASE_GITHUB_NPM_TOKEN`
  (`.npmrc`, the `@merchbaseco` GitHub Packages scope) and
  `MERCHBASE_HUGEICONS_LICENSE_KEY` (`bunfig.toml`, the private `@hugeicons-pro`
  registry). Both are `@internal` schema items, so `varlock run` does not export
  them; `.cursor/install.sh` fetches them with `varlock printenv` under
  `TMTERMINAL_RESOLVE_INSTALL_TOKENS=true`. Bun installs these scoped packages
  under each app's `node_modules`, not the workspace root.
- Clerk credentials resolve for real, so authenticated flows work without any
  manual setup.
- Run the real-PostgreSQL integration lane against the local cluster with
  `TMTERMINAL_TEST_DATABASE_URL=postgres://tmturtle:<resolved>@127.0.0.1:5437/tmterminal_test bun run test:integration`;
  the password comes from `bunx varlock printenv TMTERMINAL_DATABASE_PASSWORD`.
- `bun run lint` checks the whole tree and currently reports pre-existing Biome
  findings; CI gates only changed files via `bun run lint:changed`.
