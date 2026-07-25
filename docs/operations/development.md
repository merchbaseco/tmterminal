---
summary: Defines local installation, fast checks, live-data development, ports, environment variables, and readiness.
read_when:
  - starting or diagnosing the live-data development API or website
  - changing root scripts, ports, environment variables, readiness, or local runtime behavior
---

# Development

Trademark Turtle uses Bun 1.3.5.

## Install And Fast Checks

```bash
bun install --frozen-lockfile
bun run check
bun run build
```

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

This starts the API and Vite website on deterministic `dev-port` ports and reads
the ignored `.env`. It connects to production PostgreSQL on the Mac mini over
the established Tailscale path. It does not migrate or start a worker.

Searches and status reads use live data. Account and API-key actions write live
account state. Use the isolated integration lane for schema, ingestion, or
destructive work.

Optional local Clerk automation uses:

```dotenv
DEV_CLERK_SIGN_IN_USER_ID=<development-user>
VITE_DEV_CLERK_AUTO_SIGN_IN=true
```

The development sign-in endpoint exists only on loopback with the explicit
server opt-in. It creates a normal Clerk session and is absent in production.

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
`CLERK_AUTHORIZED_PARTIES`, so opening the same website on `localhost` is a
different origin and every data procedure answers 401.

Claude Code worktrees are fresh checkouts. `.worktreeinclude` lists the ignored
files they receive, currently `.env`; everything else comes from the session
hook.

## Environment

The ignored `.env` supplies:

- `DATABASE_URL`
- `POSTGRES_PASSWORD`
- `CLERK_SECRET_KEY`
- `CLERK_AUTHORIZED_PARTIES`
- `HUGEICONS_LICENSE_KEY`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `USPTO_API_KEY`

Package installation also needs `HUGEICONS_LICENSE_KEY` in the shell
environment so Bun can resolve the scoped `@hugeicons-pro/*` icon package (see
the root `bunfig.toml` registry scope). Compose exposes it to image builds as a
BuildKit secret. GitHub Quality receives the same value from the repository
secret. The key is install-time only; it is never stored in an image or bundled
into browser code.

Do not print, commit, copy into images, or pass source credentials to browser
code. The source key belongs only in the worker.

## Readiness

Anonymous API readiness returns only:

```json
{"status":"ready"}
```

Database failure returns HTTP 503 with `{"status":"unavailable"}`. Readiness
does not claim source completeness.
