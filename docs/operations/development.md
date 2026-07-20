---
summary: Defines local installation, fast checks, live-data development, isolated Compose, ports, environment variables, readiness, and cleanup.
read_when:
  - starting or diagnosing the workspace, API, website, worker, PostgreSQL, Caddy, or Compose
  - changing root scripts, ports, environment variables, readiness, or local runtime behavior
---

# Development

Trademark Turtle uses Bun 1.3.5 and Docker Compose.

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

## Production-shaped Compose

```bash
bun run compose:up
bun run compose:smoke
```

The wrapper derives a distinct project name, ports, volumes, and development
image labels for each checkout. Inspect assigned ports with:

```bash
dev-port --group
```

The first port serves Caddy and the website. The second serves API diagnostics.
Override both without editing Compose:

```bash
TMTURTLE_WEB_PORT=8800 TMTURTLE_API_PORT=3300 bun run compose:up
```

Follow-up commands use the wrapper so they address the same project:

```bash
bun run compose -- ps
bun run compose -- logs api
bun run compose -- logs worker
```

## Environment

The ignored `.env` supplies:

- `DATABASE_URL`
- `POSTGRES_PASSWORD`
- `CLERK_SECRET_KEY`
- `CLERK_AUTHORIZED_PARTIES`
- `VITE_CLERK_PUBLISHABLE_KEY`
- `USPTO_API_KEY`

Do not print, commit, copy into images, or pass source credentials to browser
code. The source key belongs only in the worker.

## Readiness

Anonymous API readiness returns only:

```json
{"status":"ready"}
```

Database failure returns HTTP 503 with `{"status":"unavailable"}`. Readiness
does not claim source completeness.

## Bootstrap API Key

Create a host-managed key against the current Compose database with:

```bash
bun run api-keys:create --name merchbase
```

The command runs inside the API container, resolves one stable host account,
writes the raw token once to stdout, and stores only its hash.

## Cleanup

Stop services while preserving volumes:

```bash
bun run compose:down
```

Delete isolated local volumes only for an intentional clean reset:

```bash
bun run compose -- down --volumes
```

Never use the volume-deleting command for production or routine source repair.
