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
| `tmterminal_screen` | One listing text, or up to 100 named texts; each matching live mark once per text |

Get an identity. Search a word or phrase. Screen complete listing text.

Screen several texts in one call with `texts`. Ids must be unique. The result lists each text in input order with its own matching marks:

```json
{ "texts": [{ "id": "title", "text": "It's fine shirt" }, { "id": "slogan", "text": "Kitten Nuggets" }], "singular": true, "type": "all" }
```

```json
{ "meta": { "dataVersion": "7" }, "texts": [{ "id": "title", "trademarks": [] }, { "id": "slogan", "trademarks": [] }] }
```

Screening matches singulars by default: `Kitten Nuggets` finds KITTEN NUGGET. Pass `"singular": false` to match the words as written. `tmterminal_search` takes `singular` for Multi and Split, off by default. See [Search Marks](/search-marks#singular) for the rules.

Search continuation passes `meta.dataVersion` as `expectedDataVersion`. After `CONFLICT`, restart at offset zero.

## Discovery

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
OAuth authorization-server metadata is hosted by the Cloudflare issuer advertised in the protected-resource metadata.

The same limits and error codes as the [HTTP client](/http-client) apply.

## What's next

- [Sign in](/sign-in)
- [CLI](/cli)
- [HTTP client](/http-client)
- [Results](/results)
