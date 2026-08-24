---
summary: Defines the Trademark Terminal environment contract - the committed Varlock schema, 1Password sources, per-venue delivery, and the two bootstrap identities.
read_when:
  - adding, renaming, rotating, or removing an environment variable or credential
  - wiring a new venue (local dev, CI, deploy, cloud agent) to resolved configuration
  - diagnosing a missing or wrong value in any Trademark Terminal runtime
---

# Environment

The committed [`.env.schema`](../../.env.schema) is the contract: every
canonical name, its type, its sensitivity, and its per-lifecycle source. There
is no `.env` file anywhere in this repository's workflows — not in a checkout,
not on the production host, not in a worktree. Secrets live in 1Password;
Varlock resolves them into a process environment at the moment they are needed.
That policy is deliberate and fleet-wide; preserve its shape when editing.

## Source, delivery, runtime

| Lifecycle | Selector | Secret source | Delivery |
| --- | --- | --- | --- |
| `production` | `VARLOCK_ENV=production`, pinned by the deploy script | `Production` vault | `varlock run -- docker compose` on the Mac mini; Compose writes the container spec |
| `development` | default | `Development` vault | `varlock run` around `./scripts/dev`, `./scripts/compose`, and the Cursor terminals |
| `test` | `VARLOCK_ENV=test` | none — fake-but-shaped literals | every gate runs fully offline |

The workload reads its own process environment and never contacts 1Password at
request time. `VARLOCK_ENV` is a Varlock builtin and is never delivered, so
in-container lifecycle branching reads `NODE_ENV` instead.

## Bootstrap identities

| Slot | Filled by | Reads |
| --- | --- | --- |
| `DEPLOY_AGENT_PRODUCTION_OP_TOKEN` | the `GH_DEPLOY_AGENT_PRODUCTION_OP_TOKEN` repository secret in Actions; `op run` against `op://Automation/Production Varlock - Mac Mini` for an operator run | `Production` |
| `CURSOR_CLOUD_AGENTS_DEVELOPMENT_OP_TOKEN` | Cursor's account-scoped Runtime Secret; in CI, the same repository secret as above | `Development` |

`GH_DEPLOY_AGENT_PRODUCTION_OP_TOKEN` is the only platform-held secret in this
repository. Install credentials are never repository secrets — they resolve
through the schema, because Actions' own `github.token` cannot read another
repository's GitHub Package.

## Machinery credentials

Install, build, and release credentials are `@internal`, so `varlock run`
deliberately does not export them. Each resolves only behind its context
switch, and is fetched explicitly with `varlock printenv`:

| Name | Switch | Item |
| --- | --- | --- |
| `MERCHBASE_GITHUB_NPM_TOKEN` | `TMTERMINAL_RESOLVE_INSTALL_TOKENS` | `op://Development/GitHub Packages Read - Merchbase` |
| `MERCHBASE_HUGEICONS_LICENSE_KEY` | `TMTERMINAL_RESOLVE_INSTALL_TOKENS` | `op://Development/HugeIcons Pro - Merchbase` |
| `MERCHBASE_NPM_PUBLISH_TOKEN` | `TMTERMINAL_RESOLVE_RELEASE_TOKENS` | `op://Tooling/NPM Publish - Merchbase` |

Gating matters: Vite and the Docker build re-resolve the whole schema in
contexts that cannot reach 1Password, so an ungated `op()` reference breaks the
build.

## Project-owned items

`Clerk Webhook - TMTerminal` (Production), `Postgres - TMTerminal` (Production
and Development, one credential cross-referenced in both notes),
`USPTO ODP API - TMTerminal` (Production and Development, one provider key
cross-referenced), `Dev Sign-In User - TMTerminal` (Development). Everything
Clerk-instance-wide, every package registry credential, and the icon licence
come from shared `- Merchbase` items and are never copied per repository.

## Database

One PostgreSQL instance serves both lifecycles: there is no separate
development dataset. Compose reaches it over the container network; a
workstation reaches the same database over Tailscale. Mutations from
`bun run dev` are real. The role and database are still named `tmturtle` from
before the rename; that is a database migration, not an environment change.

A Cursor cloud agent has no Tailscale, so it provisions its own PostgreSQL
cluster on the same port and overrides exactly one public value —
`TMTERMINAL_DATABASE_HOST` — for that session.

## Commands

| Task | Command |
| --- | --- |
| Validate the schema offline | `bun run env:check` |
| Diff names across schema, source, Compose, and Dockerfile | `bun run env:contract` |
| Show resolved values, masked | `bun run env:load` |
| Reveal one value | `bunx varlock reveal <NAME>` |
| Resolve production without deploying | `bun run deploy:dry-run` |
| Check delivered names after a deploy | `bun run deploy:verify` |

Both `env:check` and `env:contract` run inside `bun run check`, so a drifted
contract fails before review.

## Traps

Two behaviours of `varlock run` cost real debugging time here; both have
regression coverage in `scripts/deployment-contract.test`.

**`varlock run` strips every `@internal` item from the child, even one already
exported in the parent.** Anything that builds an image therefore cannot rely on
the install credentials being inherited — the BuildKit `required=true` mounts
arrive empty and the build fails. Every build entry point sources
`scripts/install-tokens`, which re-resolves them inside the child.

**A nested `varlock` call reuses the parent's already-resolved values, and the
bootstrap token is itself `@internal`.** So the nested resolution has no
1Password identity and silently falls back to desktop authentication, which no
CI runner has. The outer `varlock run` therefore passes `--include-internal`,
and the helper clears `__VARLOCK_RUN`/`__VARLOCK_ENV` so its own resolution is a
fresh one pinned to the development lifecycle.

## Changing a variable

1. Add or rename it in `.env.schema` with explicit `@sensitive` or `@public` and a `test` arm.
2. Update the consumers, and the Compose `environment:` block of every container that reads it.
3. Run `bun run check`.
4. For a new secret, create one 1Password item per independently rotated credential, titled `<purpose> - TMTerminal`, in the lifecycle vault it belongs to.

Rotation needs no repository change: rotate at the provider, update the item,
redeploy, verify, revoke.
