---
title: MCP
---

# MCP

Hosted MCP is at `https://tmterminal-api.merchbase.co/mcp`. Streamable HTTP. Tools only. No resources, prompts, or stdio.

Every request needs a Cloudflare Access OAuth bearer token for service `tmterminal`. API keys are rejected.

## Tools

| Tool | Job |
| --- | --- |
| `tmterminal_search` | One Search Query, one page |
| `tmterminal_get` | One exact serial or registration |
| `tmterminal_screen` | One listing text; each matching live mark once |

Get an identity. Search a word or phrase. Screen complete listing text.

Search continuation passes `meta.dataVersion` as `expectedDataVersion`. After `CONFLICT`, restart at offset zero.

## Discovery

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
OAuth authorization-server metadata is hosted by the Cloudflare issuer advertised in the protected-resource metadata.

The same limits and error codes as the HTTP client apply. Details live in the [MCP reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/mcp.md).

## What's next

- [Sign in](/sign-in)
- [CLI](/cli)
- [HTTP client](/http-client)
- [Results](/results)
