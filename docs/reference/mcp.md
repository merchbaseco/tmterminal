---
summary: Defines the hosted Trademark Terminal MCP endpoint, OAuth boundary, tools, inputs, results, and errors.
read_when:
  - connecting an agent to hosted Trademark Terminal MCP
  - changing MCP authentication, tool names, transport, inputs, or error mapping
---

# Hosted MCP

Trademark Terminal exposes a remote, stateless Model Context Protocol endpoint
at `https://tmterminal.merchbase.co/mcp`. It uses Streamable HTTP in the existing
Fastify API process and exposes tools only: no resources, prompts, sampling,
tasks, stdio transport, or selected website state.

## Authentication

Every MCP request requires a Clerk OAuth bearer token authorized for fixed
service `tmterminal`. API keys are not accepted. OAuth discovery metadata is
available at both root and path-specific well-known URLs:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-authorization-server/mcp`

Each request resolves a fresh authenticated Trademark Terminal account through
the local Access Projection. `TMTERMINAL_MCP_RESOURCE_URL` is owned by
`.env.schema`, resolves to the production MCP URL, and may select another
absolute HTTP `/mcp` URL for a deployment.

## Tools

| Tool | Canonical operation |
| --- | --- |
| `tmterminal_get` | `trademarks.get` |
| `tmterminal_search` | `trademarks.search` |
| `tmterminal_screen` | `trademarks.screen` |

The three tools use the same strict inputs, defaults, limits, and results as the
published HTTP client. Get resolves one exact identity. Search investigates one
word or phrase and returns one server page. Screen accepts one complete listing
text and returns each matching live trademark once; occurrence positions remain
available only through the richer website/HTTP match procedure.

Search continuation passes `meta.dataVersion` back as `expectedDataVersion`.
Data Version values are decimal strings on every surface. A `CONFLICT` response
means restart at offset zero.

All tools are read-only, idempotent, non-destructive, and closed-world. Trademark
reads always use Live Trademark Knowledge regardless of ingestion activity.

Successful calls return the canonical operation value as both JSON text and
identical `structuredContent`. Tool failures set `isError` and return portable
JSON text only:

```json
{"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

The error codes are the stable Trademark Terminal codes from the HTTP contract.
Unknown internal failures are sanitized as `INTERNAL_ERROR`. Endpoint
authentication failures remain HTTP 401, 403, or 503 responses with the
appropriate bearer challenge.

Trademark results are evidence, never a safety verdict or legal advice.
