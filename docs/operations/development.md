---
summary: Defines local installation, fast checks, live-data development, ports, environment variables, and readiness.
read_when:
  - starting or diagnosing the live-data development API or website
  - changing root scripts, ports, environment variables, readiness, or local runtime behavior
---

# Development

Trademark Terminal uses Bun 1.3.5.

## Install And Fast Checks

```bash
export MERCHBASE_GITHUB_NPM_TOKEN="$(TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx varlock printenv MERCHBASE_GITHUB_NPM_TOKEN)"
export MERCHBASE_HUGEICONS_LICENSE_KEY="$(TMTERMINAL_RESOLVE_INSTALL_TOKENS=true bunx varlock printenv MERCHBASE_HUGEICONS_LICENSE_KEY)"
bun install --frozen-lockfile
bun run check
bun run build
```

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

Local Clerk automation resolves from the schema:
`TMTERMINAL_DEV_CLERK_SIGN_IN_USER_ID` comes from
`op://Development/Dev Sign-In User - TMTerminal`, and
`VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN` opts the website in. The development
sign-in endpoint exists only on loopback and is absent in production.

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
