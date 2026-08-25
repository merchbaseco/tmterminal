---
summary: Trademark Terminal docs map for product behavior, internals, exact contracts, operations, design, and architecture decisions.
read_when:
  - joining Trademark Terminal development or choosing which contract to read before changing behavior
  - changing product scope, ingestion, search, clients, operations, design, or architecture
  - adding, moving, or retiring repository documentation
---

# Trademark Terminal Docs

Trademark Terminal makes trademark compliance easy for online sellers, primarily
focused on print-on-demand entrepreneurs in the merch and apparel niche.
Trademark Terminal maintains a searchable United States trademark database, and
surfaces the functionality via the tmterminal.merchbase.co website, a dedicated
HTTP API, the `tt` CLI, and hosted MCP tools native to agentic workflows.

These docs state behavior, boundaries, exact contracts, workflows, and durable
decisions that are hard to recover from code search alone. Source Status,
ingestion internals, the data model, source repair, and the live-data decision
describe how USPTO files continuously update the searchable database.

## Start Here

| Task | Read |
| --- | --- |
| Understand product scope | [Product docs](product/README.md), [Service](product/service.md) |
| Change search, matching, screening, or mark detail | [Search](product/search.md), [HTTP API](reference/http-api.md) |
| Change USPTO ingestion or precedence | [Ingestion internals](internals/ingestion.md), [Data model](reference/data-model.md), [USPTO source](reference/uspto-source.md) |
| Change source visibility or repair | [Source status](product/source-status.md), [Source repair](operations/source-repair.md) |
| Change CLI behavior | [CLI reference](reference/cli.md) |
| Change or connect to hosted MCP | [MCP reference](reference/mcp.md) |
| Change packages or system boundaries | [Architecture](internals/architecture.md) |
| Change authentication or account identity | [Access boundary](internals/access-boundary.md) |
| Change website styling or primitives | [Design system](design/system.md) |
| Run, test, or deploy the service | [Operations](operations/README.md) |
| Review accepted tradeoffs | [Decisions](decisions/README.md) |
| Use repository terminology | Root [`CONTEXT.md`](../CONTEXT.md) |

## Product

| Behavior | Doc |
| --- | --- |
| Users, authentication, clients, scope, and non-goals | [Service](product/service.md) |
| Multi, Split, Wildcard, filters, matching, screening, and mark detail | [Search](product/search.md) |
| Public status, operator issues, source files, and Repair | [Status](product/source-status.md) |

## Internals

| System | Doc |
| --- | --- |
| Workspace, service, auth, persistence, and client boundaries | [Architecture](internals/architecture.md) |
| Clerk credentials, Access Projections, and stable service accounts | [Access boundary](internals/access-boundary.md) |
| Discovery, download, validation, application, cleanup, and restart | [Ingestion](internals/ingestion.md) |

## Reference

| Contract | Doc |
| --- | --- |
| tRPC procedures, auth, pagination, and error codes | [HTTP API](reference/http-api.md) |
| `tt` commands, credentials, envelopes, and exits | [CLI](reference/cli.md) |
| Hosted MCP tools, OAuth, results, and errors | [MCP](reference/mcp.md) |
| Tables, source states, and mark precedence | [Data model](reference/data-model.md) |
| ODP access, rate limits, XML identity, and class semantics | [USPTO source](reference/uspto-source.md) |

## Operations

| Workflow | Doc |
| --- | --- |
| Install, local servers, Compose, synthetic data, ports, and readiness | [Development](operations/development.md) |
| Unit, PostgreSQL, fixture, browser, and deployment checks | [Testing](operations/testing.md) |
| Mac mini release, smoke, monitoring, and rollback | [Deployment](operations/deployment.md) |
| Prepare or execute centralized-auth cutover | [Access cutover](operations/access-cutover.md) |
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
