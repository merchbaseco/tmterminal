---
title: MCP
---

# MCP

Hosted MCP is at `https://tmterminal.merchbase.co/mcp`. Streamable HTTP. Tools only. No resources, prompts, or stdio.

Every request needs a Clerk OAuth bearer token for service `tmterminal`. API keys are rejected.

## Tools

| Tool | Job |
| --- | --- |
| `tmterminal_search` | One Search Query, one page |
| `tmterminal_get` | One exact serial or registration |
| `tmterminal_screen` | One listing text; each matching live mark once |

Get an identity. Search a word or phrase. Screen complete listing text. Treat results as evidence, never as a safety verdict.

Search continuation passes `meta.dataVersion` as `expectedDataVersion`. After `CONFLICT`, restart at offset zero.

## Discovery

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-authorization-server/mcp`

The same limits and error codes as the HTTP client apply. Details live in the [MCP reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/mcp.md).

## What's next

- [Sign in](/sign-in)
- [CLI](/cli)
- [HTTP client](/http-client)
- [Results](/results)
