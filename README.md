# Trademark Turtle

Trademark Turtle (`tmturtle`) is a headless US trademark data service for print-on-demand sellers.

It continuously discovers and ingests the latest USPTO bulk trademark artifacts, exposes a typed HTTP interface, and ships a JSON-first `tt` CLI. MerchBase will consume the same client when its embedded trademark subsystem is removed.

## Status

Planning complete. Implementation has not started.

Read [docs/plan.md](docs/plan.md) before changing architecture, ingestion, API, client, CLI, or deployment behavior.

## v1 shape

- Private API server and ingestion worker
- Dedicated PostgreSQL database
- `@tmturtle/http-client`
- `@tmturtle/cli` with the `tt` executable
- API-key authentication for every HTTP procedure
- Docker Compose deployment on the Mac mini at `tmturtle.merchbase.co`

No website, Clerk integration, billing, or anonymous routes are planned for v1.
