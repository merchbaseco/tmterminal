---
summary: Defines Trademark Terminal users, service capabilities, authentication boundaries, clients, v1 scope, and intentional omissions.
read_when:
  - changing service scope, authentication, client ownership, or anonymous access
  - deciding whether a capability belongs in Trademark Terminal, MerchBase, the website, or a published package
---

# Service

Trademark Terminal is the authenticated United States trademark service for the
MerchBase product family. It maintains USPTO-derived trademark knowledge and
serves the same typed behavior to its website, HTTP client, CLI, and downstream
products.

## Users

- Print-on-demand sellers checking listing text and clothing word marks.
- Authenticated website users searching and inspecting marks.
- MerchBase and other trusted products using the HTTP client.
- Developers and power users using the JSON-first `tt` CLI.

## Capabilities

- Search word marks with Multi, Split, and Wildcard semantics.
- Resolve exact serial and registration identities.
- Match named text documents against known live marks.
- Screen independent phrases for live exact and partial match counts.
- Query recent trademark activity through programmatic clients.
- Inspect mark identity, ownership, classes, goods, status, and provenance.
- Inspect public source freshness and recent processing activity.
- Inspect active ingestion issues as an operator.
- Persist account-level search defaults and result presentation preferences.

Trademark data is informational, not legal advice. Users verify consequential
decisions with the USPTO or qualified counsel.

## Authentication

Every data procedure requires one authenticated account context.

- The website uses a Clerk session.
- The HTTP client and CLI use suite-wide Clerk User API Keys.
- A separate OAuth tRPC endpoint accepts shared Clerk OAuth access tokens for
  downstream Merchbase products.
- Source diagnostics and operations require a Clerk session plus the
  database-backed operator role.
- Process and database readiness plus aggregate source status are anonymous.
  Public status exposes catalog counts and processing activity, not mark records,
  source errors, or repair details.

Every protected request verifies one route-appropriate Clerk credential through
`@merchbaseco/access`, evaluates fixed service `tmterminal` against the local
Access Projection, then resolves the existing Trademark Terminal account by
stable Merchbase User ID. A failed credential never falls through to another
mechanism.

Signed-out visitors may compose a search. Submission starts Clerk sign-in,
preserves the query, and executes it after authentication.

API-key creation, inspection, and retirement belong to the
[Merchbase Account Center](https://merchbase.co/account/api-keys/). Trademark
Terminal does not issue or verify product-specific keys.
Search preferences require a Clerk session and follow the account across website
sessions. Shared search URLs retain their encoded options instead of being
rewritten by account defaults.

## Clients

| Surface | Role |
| --- | --- |
| Website | Private search, text matching, bulk screening, mark detail, preferences, and an Account Center link plus public Status and Help pages. |
| `@tmterminal/http-client` | Typed programmatic access derived from the server router. |
| `@tmterminal/cli` / `tt` | JSON-first shell automation over API-key-authorized procedures. |
| MerchBase | Downstream consumer that owns its own adapter and product policy. |

The server and website are private applications. Only the HTTP client and CLI
are publication surfaces.

## V1 Boundary

Trademark Terminal materializes complete details for the private Tracked Classes
constant, initially International Class 025. The normalized schema remains
class-agnostic. Adding a class is a deliberate product and backfill change, not
runtime configuration.

V1 excludes:

- anonymous trademark search, text matching, screening, or mark-detail routes, or a public
  marketing site;
- billing, plans, teams, watches, alerts, or email delivery;
- filing, prosecution, legal-risk scores, or legal advice;
- design-mark image similarity;
- non-US sources, assignments, or TTAB datasets;
- a browser extension or custom dashboard framework.
- organizations, custom scopes, identity relinking, or a product tenancy layer.

## Related

- [Search](search.md)
- [Status](source-status.md)
- [Architecture](../internals/architecture.md)
- [Thin website decision](../decisions/thin-website-v1.md)
