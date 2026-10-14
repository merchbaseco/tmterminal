# Trademark Terminal

Use Bun and Conventional Commits. Prefer the right end state. Do not add
legacy aliases, dual-write paths, or website features outside the thin v1
surface.

Read [`GLOSSARY.md`](GLOSSARY.md) for product nouns. `CONTEXT.md` is a symlink
to that file for Matt Pocock skills.

## Invariants

- Exact serial (8 digits) and registration (7 digits) numbers are identities.
  Never treat them as search terms.
- Filter and sort on the server before pagination and count.
- USPTO artifacts update live trademark tables in bounded transactions.
  Ingestion never gates reads.
- Data procedures need a Clerk session or an API key. Anonymous routes are
  liveness (`/health/live`), the watcher report (`/api/health`), and aggregate `/api/status` only.
- Annual and daily are USPTO packaging, not query-visible datasets.

## Development

One model everywhere. `bun run dev` and cloud `.agents/cloud/start.sh` both use
local Postgres on `127.0.0.1`, apply migrations, and seed fabricated data.
The seed refuses any non-loopback host and never calls USPTO. Worker stays
off. Website origin is `127.0.0.1`, not `localhost`. Docs at `/docs` on the
website port; VitePress also serves them on `127.0.0.1:5174` during `dev`.

## Cloud agents

Claude and Cursor cloud sessions share the fleet contract (`zknicker/agents`
`cloud-agent-setup` skill). `.agents/cloud/bootstrap.sh` is a fleet-owned copy;
never edit it. The repo-owned scripts:

- `install.sh` installs the pinned Bun (`packageManager`), PostgreSQL 16, and
  `bun install --frozen-lockfile` with the two install credentials, then
  initializes the isolated cluster at `/var/lib/tmterminal` on `127.0.0.1:5437`.
  As root (Claude) the cluster runs as the `postgres` account via `runuser`.
- `start.sh` runs `scripts/dev-db` each session: start Postgres, migrate, seed
  the fabricated week. It returns; it starts no dev servers.
- `env.sh` exports Bun's path and `TMTERMINAL_DATABASE_HOST=127.0.0.1`.
- `api.sh`, `web.sh`, `docs.sh` run the API (`:3000`), website (`:5173`, proxies
  `/api` and `/docs`), and VitePress (`:5174`). Cursor runs them as terminals.
- `postgres-lib.sh` holds the cluster helpers, also used by `scripts/dev-db`.

`.claude/settings.json` runs `bootstrap.sh claude` in cloud sessions only;
`.cursor/environment.json` installs with `bootstrap.sh cursor-install` and
starts with `bootstrap.sh cursor`. Every secret resolves through
`CLOUD_AGENTS_DEVELOPMENT_OP_TOKEN` (CI uses `CI_OP_TOKEN`).

Run and screenshot the app on Claude cloud:

```bash
. .agents/cloud/env.sh
bash .agents/cloud/api.sh >/tmp/tmterminal-api.log 2>&1 &
bash .agents/cloud/web.sh >/tmp/tmterminal-web.log 2>&1 &
.cursor/skills/verify-trademark-terminal/scripts/doctor.sh
capture-page http://127.0.0.1:5173/ /tmp/tmterminal.png --settle 8000
```

`capture-page` is the fleet's Playwright wrapper around the image's Chromium; it
routes external hosts such as Clerk through the agent proxy and keeps loopback
direct.

Open `127.0.0.1`, not `localhost`. The website signs in automatically as the
shared Merchbase Dev Sign-In user (`VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN`,
set by `web.sh`), which owns the seed. Full browser acceptance follows
`.cursor/skills/verify-trademark-terminal/`.

## Secrets

The committed `.env.schema` is the contract. Varlock resolves values from
1Password. There is no `.env` file. `VARLOCK_ENV` is `production`,
`development`, or `test`. GitHub Actions stores one secret,
`GH_DEPLOY_AGENT_PRODUCTION_OP_TOKEN`, so CI and deploy can read 1Password.
Everything else comes from the schema.

## Release

Use the `release-trademark-terminal` skill. It bumps `VERSION`, updates
`CHANGELOG.md`, and opens a PR. Merging a release PR deploys through GitHub
Actions. Ordinary merges to `main` do not. Do not deploy from a laptop.

## Verification

- Parser: byte-exact USPTO XML fixtures.
- Ingestion: restart, idempotency, cleanup, replay, and live visibility.
- Search: filter, sort, count, pagination, and index use.
- Client and CLI: generated contracts plus JSON envelopes.
- Website: focused tests plus the `verify-trademark-terminal` happy and adjacent paths.
- Deploy: Compose health before release.

CI Quality is the fast lane (`bun run check:fast`). `bun run check` is the
full set. Read [Testing](docs/operations/testing.md) before changing that split.

## Operator

- Linear lives on the Products team (`PRD`) with the `Trademark Terminal`
  label. Triage labels are in [Issues](docs/operations/issues.md).
- Quiet Utility and COSS rules live in [Design](docs/design/system.md).
- Production topology and rollback notes live in
  [Deployment](docs/operations/deployment.md).
- Public docs live in `apps/docs` and ship at `/docs`. Write them with the
  fleet `write-product-docs` skill.
