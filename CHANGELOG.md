# Changelog

## Unreleased

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
