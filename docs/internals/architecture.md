---
summary: Defines Trademark Terminal workspace ownership, service processes, authentication boundary, persistence source of truth, and published client relationships.
read_when:
  - changing package boundaries, server or worker ownership, authentication, persistence, or client type generation
  - deciding whether behavior belongs in the API, worker, website, HTTP client, CLI, or MerchBase
---

# Architecture

Trademark Terminal is one Bun workspace around one PostgreSQL database. The API
serves authenticated reads and account actions; the worker maintains source
data; the website, HTTP client, and CLI consume the server contract.

## Workspace

| Surface | Owner |
| --- | --- |
| `apps/server` | Fastify/tRPC API, authentication, queries, source ingestion, worker, and Drizzle schema. |
| `apps/web` | Private Vite/React website using Clerk and TanStack Query. |
| `packages/http-client` | Published typed client derived from the server router. |
| `packages/cli` | Published `tt` JSON automation client. |
| PostgreSQL | Accounts, Access Projections, roles, source state, current trademark knowledge, and data version. |
| Artifact store | Temporary checksummed ZIP bytes reserved by source artifact. |

The API and worker use the same server image with different entrypoints. The API
does not run schedules; the worker does not serve customer procedures.

## Server Layers

- Route modules authenticate, validate, call domain services, and return narrow
  results.
- Services own product behavior and compose repositories.
- Query and repository modules own SQL.
- Drizzle schema is the database source of truth.
- External adapters own Clerk and USPTO protocols.

The HTTP client derives its inputs and outputs from the tRPC router. The website
and CLI do not define parallel DTOs or search semantics.

## Authentication Boundary

Credential selection happens before procedures run:

1. Select the credential kinds accepted by the route.
2. Verify the Clerk session, User API Key, or OAuth token with
   `@merchbaseco/access`.
3. Resolve the known issuer and subject through the local Access Projection.
4. Require granted fixed-service access for `tmterminal`.
5. Resolve one local account by stable Merchbase User ID.
6. Apply procedure-specific authorization.

The dashboard route accepts sessions and User API Keys. The separate OAuth route
accepts only OAuth tokens. Source operations additionally require a session and
database role; navigation visibility is not authorization. See
[Access boundary](access-boundary.md).

## Data Boundary

PostgreSQL is the source of truth for current product data. Search, matching,
screening, and listing read live mark tables directly; source lifecycle never
sits in their query path.
The sole global query state is a monotonic Data Version used to detect changes
between offset pages.

Source files are transport inputs, not query-visible datasets. The source ledger
is durable for operations and provenance, while ZIP bytes are temporary.

## Events And Caches

The server and TanStack Query cache are data sources of truth for the website.
UI state contains only interaction state. External realtime subscriptions are
outside v1; explicit requests and normal query invalidation refresh data.

## Deployment Boundary

Docker Compose runs PostgreSQL, one-shot migration, API, worker, and Caddy on
the Mac mini. PostgreSQL and compute move together if managed hosting becomes
necessary; the worker must not cross a home-WAN database boundary.

## Related

- [Ingestion](ingestion.md)
- [HTTP API](../reference/http-api.md)
- [Data model](../reference/data-model.md)
- [Mac mini hosting decision](../decisions/mac-mini-v1-hosting.md)
