# Trademark Turtle

Trademark Turtle (`tmturtle`) is an authenticated US trademark data service for print-on-demand sellers.

It continuously discovers and ingests the latest USPTO bulk trademark artifacts, exposes a focused search website and typed HTTP interface, and ships a JSON-first `tt` CLI. Other products, including MerchBase, consume the same typed client.

## Status

Planning is complete. The Bun workspace and production-shaped local runtime spine are runnable; product data procedures, ingestion, authentication, and search remain unimplemented.

Start with the [docs front door](docs/README.md). Architecture and scope live in [docs/plan.md](docs/plan.md), source authority in [docs/ingestion.md](docs/ingestion.md), the command contract in [docs/cli.md](docs/cli.md), and website behavior in [docs/website.md](docs/website.md).

Run the workspace and PostgreSQL integration harness through [local runtime operations](docs/operations/local-runtime.md).

## v1 shape

- Private API server and ingestion worker
- Private Vite/React website
- Dedicated PostgreSQL database
- `@tmturtle/http-client`
- `@tmturtle/cli` with the `tt` executable
- Shared MerchBase Clerk authentication for the website
- API-key authentication for the HTTP client and CLI
- Docker Compose deployment on the Mac mini at `tmturtle.merchbase.co`

No billing, marketing site, or anonymous data routes are planned for v1.
