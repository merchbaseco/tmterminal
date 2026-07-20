---
summary: Defines Trademark Turtle users, service capabilities, authentication boundaries, clients, v1 scope, and intentional omissions.
read_when:
  - changing service scope, authentication, client ownership, or anonymous access
  - deciding whether a capability belongs in Trademark Turtle, MerchBase, the website, or a published package
---

# Service

Trademark Turtle is the authenticated United States trademark service for the
MerchBase product family. It maintains USPTO-derived trademark knowledge and
serves the same typed behavior to its website, HTTP client, CLI, and downstream
products.

## Users

- Print-on-demand sellers checking listing text and clothing word marks.
- Authenticated website users searching, reading reports, and inspecting marks.
- MerchBase and other trusted products using the HTTP client.
- Developers and power users using the JSON-first `tt` CLI.

## Capabilities

- Search word marks with Multi, Split, and Wildcard semantics.
- Resolve exact serial and registration identities.
- Match listing text against known marks.
- Browse recent activity and generated reports.
- Inspect mark identity, ownership, classes, goods, status, and provenance.
- Inspect public source freshness and recent processing activity.
- Inspect active ingestion issues as an operator.
- Create and revoke API keys.

Trademark data is informational, not legal advice. Users verify consequential
decisions with the USPTO or qualified counsel.

## Authentication

Every data procedure requires one authenticated account context.

- The website uses the shared MerchBase Clerk configuration.
- The HTTP client and CLI use Trademark Turtle API keys.
- API-key management requires a Clerk session.
- Source diagnostics and operations require a Clerk session plus the
  database-backed operator role.
- Process and database readiness plus aggregate source status are anonymous.
  Public status exposes catalog counts and processing activity, not mark records,
  source errors, or repair details.

A request selects exactly one credential. Supplying Clerk and API-key
credentials together is invalid; a failed credential never falls through to
another mechanism.

Signed-out visitors may compose a search. Submission starts Clerk sign-in,
preserves the query, and executes it after authentication.

API-key self-service lists name, suffix, creation, last use, and status. Creation
asks for a name, shows the raw token exactly once, and requires acknowledgement
that it was saved. Revocation is immediate and idempotent.

## Clients

| Surface | Role |
| --- | --- |
| Website | Private search, reports, mark detail, and account management plus public Status and Help pages. |
| `@tmturtle/http-client` | Typed programmatic access derived from the server router. |
| `@tmturtle/cli` / `tt` | JSON-first shell automation over API-key-authorized procedures. |
| MerchBase | Downstream consumer that owns its own adapter and product policy. |

The server and website are private applications. Only the HTTP client and CLI
are publication surfaces.

## V1 Boundary

Trademark Turtle materializes complete details for the private Tracked Classes
constant, initially International Class 025. The normalized schema remains
class-agnostic. Adding a class is a deliberate product and backfill change, not
runtime configuration.

V1 excludes:

- anonymous trademark search, reports, or mark-detail routes, or a public
  marketing site;
- billing, plans, teams, watches, alerts, or email delivery;
- filing, prosecution, legal-risk scores, or legal advice;
- design-mark image similarity;
- non-US sources, assignments, or TTAB datasets;
- a browser extension or custom dashboard framework.

## Related

- [Search and reports](search-and-reports.md)
- [Status](source-status.md)
- [Architecture](../internals/architecture.md)
- [Thin website decision](../decisions/thin-website-v1.md)
