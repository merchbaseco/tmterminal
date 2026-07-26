# Trademark Terminal HTTP Client

Typed access to Trademark Terminal search, identity lookup, text matching, bulk
screening, account context, and service status.

## Install

```sh
bun add @tmterminal/http-client
```

## Use

```ts
import { createTmterminalClient } from "@tmterminal/http-client";

const client = createTmterminalClient({
  apiKey: process.env.TMTERMINAL_API_KEY!,
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

const matches = await client.trademarks.match({
  texts: [
    { id: "title", text: "Terminal Club shirt" },
    { id: "brand", text: "Quiet Supply" },
  ],
  type: "all",
});
```

Methods return promises directly. Named input and output types are derived from
the server router. `TmterminalError` is the stable error surface.

See the [HTTP API reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/http-api.md)
for authorization, pagination, matching, screening, and error contracts.
