# Trademark Turtle Agent Guide

## Working model

- Read `docs/plan.md` before architecture, ingestion, API, client, CLI, or deployment work.
- Prefer the right end state. Do not add legacy aliases, compatibility shims, dual-write paths, or dormant website infrastructure.
- Keep changes small and reviewable. Preserve unfamiliar work.
- Use Bun and the repository's pinned toolchain.
- Use Conventional Commit messages.
- Do not push unless explicitly asked.

## Product contract

- Trademark Turtle is a headless service for print-on-demand sellers.
- The service owns USPTO discovery, downloads, parsing, normalization, persistence, freshness, and search semantics.
- Callers learn the typed Trademark Turtle interface; they do not learn USPTO dataset or parser details.
- Every HTTP procedure requires an API key. There are no anonymous data routes in v1.
- Exact serial and registration numbers are identities. Never treat them as fuzzy search terms.
- Apply filtering and sorting on the server before pagination and count.
- Corpus state is database-backed. Worker completion must be observable across processes.

## Code shape

- Target a Bun workspace with `apps/server`, `packages/http-client`, and `packages/cli`.
- Keep the server app private. Publish only the HTTP client and CLI.
- Keep SQL in query/repository modules; route modules call domain services.
- Derive client input/output types from the server router. Do not duplicate DTOs.
- Keep files cohesive, use kebab-case names, avoid barrel exports, and export only imported symbols.
- Test behavior through module interfaces using real PostgreSQL where persistence semantics matter.

## Verification

- Parser changes require real XML fixtures.
- Ingestion changes require replay/idempotency coverage.
- Search changes require filter, sort, count, pagination, and index-use coverage.
- Client and CLI changes require contract generation/build plus JSON-envelope tests.
- Deployment changes require local Compose health verification before release.
