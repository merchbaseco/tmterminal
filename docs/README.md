---
summary: Trademark Turtle docs map for product behavior, internals, exact contracts, operations, design, and architecture decisions.
read_when:
  - joining Trademark Turtle development or choosing which contract to read before changing behavior
  - changing product scope, ingestion, search, clients, operations, design, or architecture
  - adding, moving, or retiring repository documentation
---

# Trademark Turtle Docs

Trademark Turtle makes trademark compliance easy for online sellers, primarily
focused on print-on-demand entrepreneurs in the merch and apparel niche.
Trademark Turtle maintains a searchable United States trademark database, and
surfaces the functionality via the tmturtle.merchbase.co website, a dedicated
HTTP API, and the `tt` CLI native to agentic workflows.

These docs state behavior, boundaries, exact contracts, workflows, and durable
decisions that are hard to recover from code search alone. Source Status,
ingestion internals, the data model, source repair, and the live-data decision
describe how USPTO files continuously update the searchable database.

## Start Here

| Task | Read |
| --- | --- |
| Understand product scope | [Product docs](product/README.md), [Service](product/service.md) |
| Change search, reports, or mark detail | [Search and reports](product/search-and-reports.md), [HTTP API](reference/http-api.md) |
| Change USPTO ingestion or precedence | [Ingestion internals](internals/ingestion.md), [Data model](reference/data-model.md), [USPTO source](reference/uspto-source.md) |
| Change source visibility or repair | [Source status](product/source-status.md), [Source repair](operations/source-repair.md) |
| Change CLI behavior | [CLI reference](reference/cli.md) |
| Change packages or system boundaries | [Architecture](internals/architecture.md) |
| Change website styling or primitives | [Design system](design/system.md) |
| Run, test, or deploy the service | [Operations](operations/README.md) |
| Review accepted tradeoffs | [Decisions](decisions/README.md) |
| Use repository terminology | Root [`CONTEXT.md`](../CONTEXT.md) |

## Product

| Behavior | Doc |
| --- | --- |
| Users, authentication, clients, scope, and non-goals | [Service](product/service.md) |
| Multi, Split, Wildcard, filters, reports, and mark detail | [Search and reports](product/search-and-reports.md) |
| Public status, operator issues, source files, and Repair | [Status](product/source-status.md) |

## Internals

| System | Doc |
| --- | --- |
| Workspace, service, auth, persistence, and client boundaries | [Architecture](internals/architecture.md) |
| Discovery, download, validation, application, cleanup, and restart | [Ingestion](internals/ingestion.md) |

## Reference

| Contract | Doc |
| --- | --- |
| tRPC procedures, auth, pagination, and error codes | [HTTP API](reference/http-api.md) |
| `tt` commands, credentials, envelopes, and exits | [CLI](reference/cli.md) |
| Tables, source states, and mark precedence | [Data model](reference/data-model.md) |
| ODP access, rate limits, XML identity, and class semantics | [USPTO source](reference/uspto-source.md) |

## Operations

| Workflow | Doc |
| --- | --- |
| Install, local servers, Compose, ports, and readiness | [Development](operations/development.md) |
| Unit, PostgreSQL, fixture, browser, and deployment checks | [Testing](operations/testing.md) |
| Mac mini release, smoke, monitoring, and rollback | [Deployment](operations/deployment.md) |
| Inspect and repair one source file | [Source repair](operations/source-repair.md) |
| Create and triage Linear work | [Issues](operations/issues.md) |
| Maintain documentation | [Docs policy](docs-policy.md) |

## Decisions

| Decision | Doc |
| --- | --- |
| Keep all usable trademark data immediately queryable | [Live trademark knowledge](decisions/live-trademark-knowledge.md) |
| Include a thin authenticated website in v1 | [Thin website](decisions/thin-website-v1.md) |
| Host v1 on the Mac mini | [Mac mini hosting](decisions/mac-mini-v1-hosting.md) |

Every Markdown file under `docs/` carries `summary` and `read_when`
frontmatter so `bun run docs:list` can route work before code changes.
