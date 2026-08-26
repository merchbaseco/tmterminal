---
summary: Defines local installation, fast checks, live-data development, automatic development sign-in, synthetic data seeding and its local-only guard, development server binds, ports, and readiness.
read_when:
  - starting or diagnosing the live-data development API or website
  - changing root scripts, ports, bind addresses, environment variables, readiness, or local runtime behavior
  - seeding synthetic trademark data, or changing what the seed produces, which database it may touch, or how cloud sessions get it
  - changing automatic development sign-in, or diagnosing a cloud session that opens signed out, empty, or unreachable
---

# Development

Trademark Terminal uses Bun 1.3.5.

## Install And Fast Checks

```bash
export MERCHBASE_GITHUB_NPM_TOKEN="$(TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx varlock printenv MERCHBASE_GITHUB_NPM_TOKEN)"
export MERCHBASE_HUGEICONS_LICENSE_KEY="$(TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx varlock printenv MERCHBASE_HUGEICONS_LICENSE_KEY)"
bun install --frozen-lockfile
bun run check:fast
```

`check:fast` is the polite lane — the environment contract, typecheck, and the
fast tests — and it is exactly what the Quality workflow runs on every push and
pull request. Before pushing, run the full set, which adds fixture tooling, the
Compose PostgreSQL integration lane, and every workspace build:

```bash
bun run check
```

That split is deliberate; see "Quality is the fast lane, on purpose" in
`docs/operations/testing.md` before changing it.

`.npmrc` maps `@merchbaseco` to GitHub Packages and `bunfig.toml` maps
`@hugeicons-pro` to the vendor registry; both contain only environment
placeholders. Both credentials are `@internal` schema items, so `varlock run`
does not export them — they are fetched explicitly under the install switch.
The Claude Code session hook does this automatically for a fresh checkout.

Lint touched authored files explicitly:

```bash
bun run lint -- <paths...>
```

Use `bun run lint:fix -- <paths...>` only for intentional formatting fixes. Do
not run a repository-wide autofix during feature work.

## Live-data Development

```bash
bun run dev
```

This starts the API and Vite website on deterministic `dev-port` ports. Every
value resolves from the committed `.env.schema` through 1Password — there is no
`.env` step. It connects to production PostgreSQL on the Mac mini over the
established Tailscale path. It does not migrate or start a worker.

Searches and status reads use live data. Account preference actions write live
account state. Use the isolated integration lane for schema, authentication, or
destructive work.

Development sign-in resolves from the schema.
`TMTERMINAL_DEV_CLERK_SIGN_IN_USER_ID` is the shared Merchbase Dev Sign-In user
— an opaque identifier in the development Clerk instance, committed rather than
vaulted, because an ephemeral worktree or cloud VM has to be correct before it
can reach 1Password. `VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN` opts the website
in, and it is off for a workstation: `bun run dev` still signs in by hand.

`POST /api/dev/clerk-sign-in-token` mints a 60-second Clerk sign-in ticket for
that user. It is absent whenever `NODE_ENV=production`, absent when the user id
is unset (which is what the production lifecycle resolves), and answers only a
caller on this machine — the peer address is the gate, not the `Host` header, so
it keeps working behind a port forwarder without widening who can mint a ticket.
Tickets are never logged.

## Synthetic Development Data

`bun run db:seed:dev` fills a **local** database with a fabricated week of
trademark activity, so search, mark detail, screening, and Source Status render
something instead of empty states. It never runs automatically on a
workstation.

One run writes roughly six thousand rows in well under a second:

| What | Shape |
| --- | --- |
| Register | 600 marks with classes, owners, goods and services wording, and status events. |
| Word families | Marks crowd deliberately: several serials share a word mark and many share a token, so exact, partial, Split, and Wildcard searches return different counts. |
| Status and type | Live, dead, and unknown marks, and every drawing-code bucket, so each search filter has both sides. |
| Source files | One USPTO daily file per day of the window plus an annual baseline, covering complete, applying, awaiting-application, blocked, needs-attention, and deferred states. |
| Worker | A worker row that has just checked in, naming the file it is applying. |
| Account | One account, owned by the shared Merchbase Dev Sign-In user, with saved, non-default search preferences. |
| Access | That user's Access Projection, so the signed-in developer is authorized to see all of it. |

Every mark is attributed to the source file that carried it, and its
transaction date is that file's day, so Latest Processed, the activity chart,
and the newest-activity sort all agree. Activity concentrates in the last seven
days, and the window ends two days ago, so the data always describes the
current week.

Useful flags:

| Flag | Effect |
| --- | --- |
| `--seed=<string>` | Picks the dataset. The same seed always produces the same register. |
| `--marks=<n>` | Size of the catalog. Default 600. |
| `--days=<n>` | Length of the source-file window. Default 30. |
| `--merchbase-user-id=<mbu_…>` | Merchbase user the seeded account maps to. Defaults to the shared Merchbase Dev Sign-In user. |

The run prints a receipt: the database it wrote to, the Merchbase user and Clerk
subject the data and the Access Projection belong to, a row count per table, and
the day the newest applied source file covers. It carries no credential.

Re-running replaces the previous dataset rather than stacking a second one on
top: every table the seed owns is cleared inside the same transaction that
refills it. The seed removes only its own account row, so an account you created
by signing in with your own Clerk user keeps its saved preferences. Preferences
saved while signed in as the Dev Sign-In user do not survive: that is the seed's
own row, and a cloud session re-seeds on every boot.

### It authorizes before it fills

The seed's first act is `bootstrapDevAccessProjection` from
`@merchbaseco/access/dev`, which writes the Access Projection a Clerk webhook
would have delivered for the shared Merchbase Dev Sign-In user. Without it a
migrated database has no projection at all and every data procedure fails before
any of these rows can be seen. See
[Access Boundary](../internals/access-boundary.md) for what the bootstrap
refuses and what to do when it reports a newer event.

Every account in a seeded database is granted the `operator` role, so the
operator Source Status surface renders for the seeded user and for a developer's
own Clerk-created account alike. The loopback guard is what keeps that grant off
any shared database. Sign in with your own account first, then re-seed, to pick
up the grant.

The seeded worker heartbeat goes stale after five minutes and Source Status
then reports the worker as failed. That is the truth about a database with no
worker attached; re-run the seed to refresh it.

### It writes local rows only

The seed fabricates every row. It never calls the USPTO Open Data Portal, and
it never leaves a source artifact in a state a running ingestion worker would
reserve — no `required` download left `pending`, nothing left `downloading`,
and no un-applied artifact carrying retained bytes. Discovery is stamped fresh
for the same reason. `apps/server/test/unit/dev-seed-plan.test.ts` asserts that
across seeds.

### It refuses anything but a local database

Development resolves to the live Trademark Terminal database on the Mac mini
over Tailscale, so "not production" is not a safe test for a script that
rewrites the trademark tables. The seed therefore accepts only a loopback
database host — `127.0.0.1`, `::1`, or `localhost` — and refuses everything
else with a loud error before it opens a connection. `NODE_ENV=production` is
refused too. There is no override flag.

To seed, point the run at a PostgreSQL on your machine:

```bash
TMTERMINAL_DATABASE_HOST=127.0.0.1 bun run db:seed:dev
```

The seed applies pending migrations first, so it works against an empty
database.

### Cloud sessions

Cursor Cloud Agents get the data for free: `.cursor/start.sh` provisions the
isolated local cluster, migrates it, and seeds it on every boot. Seeding is per
boot rather than baked into the environment snapshot because the dataset is
anchored to the current date, and a week-old snapshot would show a week-old
week. The seed's receipt is the boot's receipt, so it is printed rather than
discarded. A failed seed logs and is skipped; it never blocks the session.

Such a session opens signed in. `.cursor/web.sh` exports
`VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN=true`, the website asks the API for a
ticket on load, and the Merchbase Dev Sign-In user it authenticates as is the
one the seeded data and its Access Projection belong to. A workstation is
deliberately not armed this way.

## Development Server Binds

`TMTERMINAL_DEV_HOST` is the Vite development server's bind address and
`TMTERMINAL_HOST` is the API's. Both default to loopback, which keeps a
development server — and the synthetic data behind it — off the network.

A venue reached through a port forwarder sets both to `0.0.0.0` for its own
commands, because such forwarders find a session's ports by watching for
listening sockets and a loopback-only bind is invisible to them.
`.cursor/api.sh` and `.cursor/web.sh` do exactly that, which is where the
knowledge that Cursor works this way belongs — application code stays
vendor-neutral. A widened `TMTERMINAL_DEV_HOST` also relaxes Vite's host
allowlist, because a forwarded request arrives carrying the forwarder's own name
in `Host` and Vite would otherwise answer "Blocked request" instead of the
website.

Only the socket widens. The Clerk session still has to carry an authorized
party, so the browser origin remains the loopback one
`TMTERMINAL_CLERK_AUTHORIZED_PARTIES` names.

## Agent Harnesses

Codex and Claude Code share `AGENTS.md`; `CLAUDE.md` is a symlink to it.

Codex reads `.codex/environments/environment.toml` for its setup script and
`dev` action. Claude Code reads the tracked `.claude/settings.json`, whose
`SessionStart` hook runs `./scripts/claude-session-start`. That script installs
workspace dependencies when a checkout has none and writes the ignored
`.claude/launch.json` so the editor's preview control starts `./scripts/dev` on
this checkout's first `dev-port`.

The launch config pins the preview to `http://127.0.0.1:<port>`. Clerk
authorizes the exact origin `./scripts/dev` exports as
`TMTERMINAL_CLERK_AUTHORIZED_PARTIES`, so opening the same website on
`localhost` is a different origin and every data procedure answers 401.

Claude Code worktrees are fresh checkouts and need no ignored files: the
committed schema is the whole environment contract, and the session hook
installs dependencies.

## Environment

Names, sources, and per-venue delivery live in [Environment](environment.md).
Nothing in this repository reads a `.env` file.

Install credentials are install-time only: Compose passes them to image builds
as BuildKit secrets, and they are never stored in an image layer, an image
environment variable, or browser code. The USPTO source key belongs only to the
worker.

## Readiness

Anonymous API readiness returns only:

```json
{"status":"ready"}
```

Database failure returns HTTP 503 with `{"status":"unavailable"}`. Readiness
does not claim source completeness.
