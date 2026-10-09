# Changelog

## Unreleased

## 1.0.2 - 2026-10-09

**Features**

- feat(health): `GET /api/health` is the watcher report. HTTP 200 is `{"status":"ok"}`. HTTP 503 is `{"status":"degraded","failing":[...]}` with `database`, `worker`, and `uspto_data`. `worker` fails when the USPTO heartbeat is missing, older than 5 minutes, or the worker is stopped. Discovery backoff does not fail `worker`. `uspto_data` fails when the last successful update is missing or older than 96 hours. Callers that expected `{"status":"ready"}` or `{"status":"unavailable"}` now receive `ok` or `degraded`.

**Fixes**

- fix(health): `GET /health/live` runs `select 1` and returns HTTP 200 `{"status":"ok"}`. Docker healthchecks, Caddy, `depends_on`, the worker supervision file, and deployment smoke use this URL. A stale worker or a stale USPTO update does not fail these checks.

## 1.0.1 - 2026-10-05

**Fixes**

- fix(ingestion): Allow catalog discovery retry after transient USPTO 429/503 responses with backoff timing
- fix(ci): Stop wrapping deploy preflight check in varlock run

**Internal**

- feat: Seed fleet agents and pstack configuration on every cloud boot
- feat: Add verify-trademark-terminal browser skill for website validation
- docs: License repository under Apache 2.0

## 1.0.0 - 2026-08-27

First numbered Trademark Terminal release.

- Authenticated website: Search Marks, Check Text, Bulk Check, mark records, status, and account keys
- Seller docs at `/docs`; `/help` redirects there
- CLI, HTTP client, and hosted MCP
- One local development model: loopback Postgres and fabricated seed data
- Production deploys from GitHub Actions when `VERSION` changes on `main`
