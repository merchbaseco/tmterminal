# Trademark Turtle HTTP Client

Typed access to Trademark Turtle search, identity lookup, text matching, bulk
screening, account context, and service status.

## Install

```sh
bun add @tmturtle/http-client
```

## Use

```ts
import { createTmturtleClient } from "@tmturtle/http-client";

const client = createTmturtleClient({
  apiKey: process.env.TMTURTLE_API_KEY!,
});

const results = await client.trademarks.search({
  match: "both",
  mode: "multi",
  query: "turtle club",
  status: "live",
});

const trademark = await client.trademarks.get({
  serialNumber: "60146682",
});

const matches = await client.trademarks.match({
  texts: [
    { id: "title", text: "Turtle Club shirt" },
    { id: "brand", text: "Quiet Supply" },
  ],
  type: "all",
});
```

Methods return promises directly. Named input and output types are derived from
the server router. `TmturtleError` is the stable error surface.

See the [HTTP API reference](https://github.com/merchbaseco/tmturtle/blob/main/docs/reference/http-api.md)
for authorization, pagination, matching, screening, and error contracts.
