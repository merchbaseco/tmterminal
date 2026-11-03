# Changelog

## Unreleased

**Features**

- Breaking: HTTP `marks.screen` is now text screening and takes `text` or named `texts`, like MCP `tmterminal_screen`. The old `marks.screen` (per-phrase counts) is `marks.bulkCheck`, and `marks.screenText` is gone. The HTTP client adds `trademarks.bulkCheck` and lets `trademarks.screen` take `texts`; the CLI adds `tt bulk-check` and repeatable `tt screen --text`.
- feat(web): Search has a Mode menu for Multi, Split, and Wildcard. Check Text and Bulk Check have a Type menu. Every Type menu, and the account default, offers Other.
- feat(search): `singular` matches plural words as singular marks, on both sides, so `kitten nuggets` finds KITTEN NUGGET and `milk and cookies` finds MILK AND COOKIE. Screening (`screen`, `bulkCheck`, `match`, MCP `tmterminal_screen`, `tt screen`, `tt bulk-check`, Check Text, Bulk Check) has it on by default; Multi and Split search take it off by default; Wildcard rejects it. The rules match Factory's `tm_forms.py`. Migration 0033 adds `singular_match_key()` and four expression indexes; it builds indexes without rewriting `mark`.

- feat(mcp): `tmterminal_screen` accepts `texts`, up to 100 `{id, text}` items, and returns `texts: [{id, trademarks}]` in input order. The single `text` form is unchanged.
- feat(search): Multi, Split, Bulk Check, and text screening match on a punctuation-folded key. Apostrophes are dropped and other punctuation separates words, so `it's fine` finds IT'S FINE and ITS FINE. Split no longer turns `it's` into `it s`. Wildcard keeps punctuation literal.
- Changed: `%`, `_`, and `\` count as punctuation outside Wildcard, so Multi `50%` also finds 50X SYMBOL. A punctuation-only Multi query or Bulk Check line matches nothing.

## 2.0.0 - 2026-10-29

**Changed**

- Breaking: sign in through Cloudflare Access. API and MCP connections move to `https://tmterminal-api.merchbase.co` and require a replacement Merchbase API key or fresh Cloudflare sign-in.
- Account permissions and revocations reach API requests and background work without Clerk verification calls.

- Production deploys on every push to `main` after Quality succeeds for that commit. `VERSION` no longer selects the deploy.

## 1.0.3 - 2026-10-20

**Features**

- feat(health): `GET /health/live` and `GET /api/health` include `revision`. Deployed images report the 40-character git SHA baked from `TMTERMINAL_REVISION`. Local dev and tests report `dev`.

**Fixes**

- fix(mcp): Publish Get and Search input fields, identity alternatives, search modes, defaults, and constraints from the canonical validation schemas. MCP clients can discover the accepted inputs while tool calls retain the same validation.
- fix(cloud): Fetch the Cursor fleet with npx during cloud setup.

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
