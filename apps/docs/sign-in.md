---
title: Sign in and API keys
---

# Sign in and API keys

The website uses a Clerk session from your MerchBase account. Data procedures also accept a suite-wide API key. There are no Trademark Terminal-only keys, and there are no anonymous search routes.

## Website

Open [tmterminal.merchbase.co](https://tmterminal.merchbase.co/search) and sign in. Search defaults live on [Account](https://tmterminal.merchbase.co/account). Status and these docs stay readable while signed out.

## API keys

Create and retire keys in the [MerchBase Account Center](https://merchbase.co/account/api-keys/). The same key works for `tt` and `@tmterminal/http-client`.

Hosted MCP does not accept API keys. It uses Clerk OAuth. See [MCP](/mcp).

## What a key can call

| Job | Session | API key |
| --- | --- | --- |
| Search, get, screen, match | Yes | Yes |
| Account identity and public status | Yes | Yes |
| Search defaults | Yes | No |
| Operator source pages | Operator session | No |
| Hosted MCP | OAuth only | No |
