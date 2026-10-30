# Trademark Terminal HTTP Client

Typed access to Trademark Terminal search, identity lookup, listing-text
screening, rich text matching, recent activity, account context, and service
status.

## Install

```sh
bun add @tmterminal/http-client
```

## Use

```ts
import { createTmterminalClient } from "@tmterminal/http-client";

const client = createTmterminalClient({
  apiKey: process.env.MERCHBASE_API_KEY!,
});

const results = await client.trademarks.search({
  match: "both",
  mode: "multi",
  query: "terminal club",
  status: "live",
});

const trademark = await client.trademarks.get({
  serialNumber: "60146682",
});

const screened = await client.trademarks.screen({
  text: "Terminal Club shirt",
  type: "all",
});

const matches = await client.trademarks.match({
  texts: [
    { id: "title", text: "Terminal Club shirt" },
    { id: "brand", text: "Quiet Supply" },
  ],
  type: "all",
});
```

Methods return promises directly. Named input and output types are derived from
the server router. `screen` returns each matching live trademark once; `match`
retains named documents and occurrence spans for richer applications.
`TmterminalError` is the stable error surface.

## Authorization

The default origin is `https://tmterminal-api.merchbase.co`. `apiKey` accepts a
suite-wide `mbk_v1` machine credential from the
[Merchbase Account Center](https://merchbase.co/account/api-keys/). It becomes
native Cloudflare service-token headers. OAuth callers instead pass
`{ accessToken }`; the opaque token is sent as Bearer to the edge. Supply exactly
one credential. Redirects are not followed.

Browser sessions use the interactive website and same-origin cookies. Public
API credentials can read trademarks, status, and account context; they cannot
change browser preferences or use operator pages. Hosted MCP accepts OAuth
people only. Health routes remain anonymous.

## Pagination and errors

Filtering, sorting, count, and offset happen on the server. Paged responses
include `meta.dataVersion`. Continuation requests may pass that value as
`expectedDataVersion`. A material live-data change returns `CONFLICT`.

Stable error codes are `UNAUTHORIZED`, `FORBIDDEN`, `BAD_REQUEST`,
`NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`,
`SERVICE_UNAVAILABLE`, and `INTERNAL_ERROR`. `SERVICE_UNAVAILABLE` is a
dependency failure. It never means ingestion is incomplete.

Hosted MCP exposes `tmterminal_get`, `tmterminal_search`, and
`tmterminal_screen` over Streamable HTTP at
`https://tmterminal-api.merchbase.co/mcp`.
