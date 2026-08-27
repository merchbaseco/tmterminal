![Trademark Terminal — USPTO trademark search for print-on-demand sellers](assets/brand/github-header.png)

# Trademark Terminal

Trademark Terminal makes trademark compliance easy for online sellers, primarily focused on print-on-demand entrepreneurs in the merch and apparel niche. Trademark Terminal maintains a searchable United States trademark database and surfaces the functionality through the [tmterminal.merchbase.co](https://tmterminal.merchbase.co) website, a dedicated HTTP API, the `tt` CLI, and hosted MCP tools native to agentic workflows.

## What Trademark Terminal does

Trademark Terminal gives sellers one place to:

- search word marks using Multi, Split, or Wildcard matching;
- look up an exact serial or registration number;
- check listing text against known trademarks;
- retrieve recent filings, registrations, and marks published for opposition through the API;
- review a mark's status, owner, classes, goods and services, and source history.

Searches run against Trademark Terminal's current best-known view of the USPTO record. New source files update that view as they are processed; ingestion never takes the existing database offline.

Trademark data is informational, not legal advice. Verify consequential decisions with the USPTO or qualified counsel.

## Ways to use it

| Interface | Best for |
| --- | --- |
| [Website](https://tmterminal.merchbase.co) | Interactive search, trademark detail, account access, public status, and help. |
| HTTP API | Typed integrations with trademark search, exact lookups, text matching, and bulk screening. |
| `@tmterminal/http-client` | TypeScript applications that want typed Trademark Terminal input and output contracts. |
| `@tmterminal/cli` (`tt`) | JSON-first exact lookup, search, and listing-text screening. |
| Hosted MCP | OAuth-authorized tools for trademark research agents. |

The website uses a Clerk session. The HTTP API, client, and CLI accept suite-wide
MerchBase User API Keys managed in the MerchBase Account Center. MerchBase
consumes the shared OAuth API. Hosted MCP accepts Clerk OAuth access tokens only.

## Data coverage

Trademark Terminal continuously processes the USPTO's bulk trademark data and keeps one live, searchable database. The initial product focuses on International Class 025—clothing, footwear, and headwear—while keeping the underlying model ready for additional classes.

Inactive and abandoned marks remain searchable because they are still part of the trademark record. Source progress and individual file problems are visible to operators without blocking customer searches.

## Repository

Trademark Terminal is a Bun and TypeScript workspace:

| Path | Purpose |
| --- | --- |
| `apps/server` | Authenticated HTTP and MCP API, PostgreSQL persistence, and USPTO ingestion worker. |
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

See [development](docs/operations/development.md) for environment setup and
[testing](docs/operations/testing.md) for PostgreSQL and production-shaped
verification.

## Project status

Trademark Terminal is under active development. Authentication, search, exact
lookups, the website, HTTP client, CLI, and production runtime are operational.
The hosted MCP is implemented and awaits deployment. USPTO ingestion updates
the live trademark database directly. See
[ingestion](docs/internals/ingestion.md) and
[live trademark knowledge](docs/decisions/live-trademark-knowledge.md).

Seller-facing product help lives on
[tmterminal.merchbase.co/help](https://tmterminal.merchbase.co/help). CLI and
HTTP contracts live in [`packages/cli`](packages/cli/README.md) and
[`packages/http-client`](packages/http-client/README.md). Shared nouns live in
[`GLOSSARY.md`](GLOSSARY.md). Remaining maintainer notes are listed in
[`docs/README.md`](docs/README.md).
