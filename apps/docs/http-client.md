---
title: HTTP client
---

# HTTP client

`@tmterminal/http-client` is the typed TypeScript client. Named input and output types are derived from the server router.

## Install

```sh
bun add @tmterminal/http-client
```

## First request

```ts
import { createTmterminalClient } from "@tmterminal/http-client";

const client = createTmterminalClient({
  apiKey: process.env.MERCHBASE_API_KEY!,
});

const results = await client.trademarks.search({
  match: "both",
  mode: "multi",
  query: "TERMINAL CLUB",
  status: "live",
});
```

```ts
const trademark = await client.trademarks.get({
  serialNumber: "60146682",
});

const screened = await client.trademarks.screen({
  text: "Terminal Club shirt",
  type: "all",
});
```

`screen` returns each matching live trademark once. `match` keeps named documents and occurrence spans. `TmterminalError` is the stable error surface.

Filtering, sorting, count, and offset happen on the server. Paged responses include `meta.dataVersion`. Pass it back as `expectedDataVersion`. A material live-data change returns `CONFLICT`.

Authorization, pagination, and error codes live in the [package README](https://github.com/merchbaseco/tmterminal/blob/main/packages/http-client/README.md) and the [HTTP API reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/http-api.md).

## What's next

- [CLI](/cli)
- [MCP](/mcp)
- [Search Marks](/search-marks)
- [Check Text](/check-text)
