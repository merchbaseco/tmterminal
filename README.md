![Trademark Terminal — USPTO trademark search for print-on-demand sellers](assets/brand/github-header.png)

# Trademark Terminal

Trademark Terminal makes trademark compliance easy for online sellers, primarily focused on print-on-demand entrepreneurs in the merch and apparel niche. Trademark Terminal maintains a searchable United States trademark database and surfaces the functionality through the [tmterminal.merchbase.co](https://tmterminal.merchbase.co) website, a dedicated HTTP API, and the `tt` CLI native to agentic workflows.

## What Trademark Terminal does

Trademark Terminal gives sellers one place to:

- search word marks using Multi, Split, or Wildcard matching;
- look up an exact serial or registration number;
- check listing text against known trademarks;
- retrieve recent filings, registrations, and marks published for opposition through the API or CLI;
- review a mark's status, owner, classes, goods and services, and source history.

Searches run against Trademark Terminal's current best-known view of the USPTO record. New source files update that view as they are processed; ingestion never takes the existing database offline.

Trademark data is informational, not legal advice. Verify consequential decisions with the USPTO or qualified counsel.

## Ways to use it

| Interface | Best for |
| --- | --- |
| [Website](https://tmterminal.merchbase.co) | Interactive search, trademark detail, account access, public status, and help. |
| HTTP API | Typed integrations with trademark search, exact lookups, text matching, and bulk screening. |
| `@tmterminal/http-client` | TypeScript applications that want typed Trademark Terminal input and output contracts. |
| `@tmterminal/cli` (`tt`) | JSON-first shell automation and agentic workflows. |

The website uses a Clerk session. The HTTP API, client, and CLI accept suite-wide
MerchBase User API Keys managed in the MerchBase Account Center. MerchBase
consumes the shared OAuth API.

## Data coverage

Trademark Terminal continuously processes the USPTO's bulk trademark data and keeps one live, searchable database. The initial product focuses on International Class 025—clothing, footwear, and headwear—while keeping the underlying model ready for additional classes.

Inactive and abandoned marks remain searchable because they are still part of the trademark record. Source progress and individual file problems are visible to operators without blocking customer searches.

## Repository

Trademark Terminal is a Bun and TypeScript workspace:

| Path | Purpose |
| --- | --- |
| `apps/server` | Authenticated HTTP API, PostgreSQL persistence, and USPTO ingestion worker. |
| `apps/web` | React website for search, trademark detail, account access, and operations. |
| `packages/http-client` | Typed programmatic client derived from the server contract. |
| `packages/cli` | The `tt` command-line interface. |
| `docs` | Product, architecture, reference, and operations documentation. |

Install dependencies and start the development environment:

```sh
bun install
bun run dev
```

Run the standard verification lanes:

```sh
bun run check
bun run lint
bun run build
```

See [development operations](docs/operations/development.md) for environment setup and [testing](docs/operations/testing.md) for PostgreSQL and production-shaped verification.

## Project status

Trademark Terminal is under active development. Authentication, search, exact lookups, the website, HTTP client, CLI, and production runtime are operational. USPTO ingestion updates the live trademark database directly; the accepted design is documented in [ingestion internals](docs/internals/ingestion.md).

Start with the [documentation index](docs/README.md). Product behavior lives under [product](docs/product/README.md), system ownership under [internals](docs/internals/README.md), exact contracts under [reference](docs/reference/README.md), and maintainer workflows under [operations](docs/operations/README.md).
