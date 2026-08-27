---
title: Sign in
---

# Sign in

Every data procedure needs a Clerk session or a suite-wide API key. There are no Trademark Terminal-only keys and no anonymous search routes.

## Website

Open [tmterminal.merchbase.co](https://tmterminal.merchbase.co/search) and sign in. You can compose a Search Query while signed out. Submitting starts Clerk sign-in, keeps the query, and runs it after authentication.

Search defaults live on [Account](https://tmterminal.merchbase.co/account). [Status](/status) and these docs stay readable while signed out.

## API keys

Create and retire keys in the [MerchBase Account Center](https://merchbase.co/account/api-keys/). The same key works for `tt` and `@tmterminal/http-client`.

```sh
export MERCHBASE_API_KEY="your_api_key"
```

Hosted MCP does not accept API keys. It uses Clerk OAuth. See [MCP](/mcp).

## What a key can call

| Job | Session | API key |
| --- | --- | --- |
| Search, get, screen, match | Yes | Yes |
| Account identity and public status | Yes | Yes |
| Search defaults | Yes | No |
| Operator source pages | Operator session | No |
| Hosted MCP | OAuth only | No |

## What's next

- [Quickstart](/quickstart)
- [CLI](/cli)
- [HTTP client](/http-client)
- [MCP](/mcp)
