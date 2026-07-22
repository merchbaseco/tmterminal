# Trademark Turtle HTTP Client

Typed access to Trademark Turtle search, exact trademark identities, listing
text matching, reports, account context, and service status.

## Install

```sh
bun add @tmturtle/http-client
```

## Use

```ts
import { createTmturtleClient } from "@tmturtle/http-client";

const client = createTmturtleClient({
  apiKey: process.env.TMTURTLE_API_KEY!,
  baseUrl: "https://tmturtle.merchbase.co",
});

const results = await client.trademarks.search.query({
  match: "both",
  mode: "multi",
  query: "turtle club",
  status: "live",
});

const trademark = await client.trademarks.get.query({
  serialNumber: "60146682",
});
```

The package exports `TmturtleClient`, `TmturtleRouterInputs`, and
`TmturtleRouterOutputs`. See the [HTTP API reference](https://github.com/merchbaseco/tmturtle/blob/main/docs/reference/http-api.md)
for authorization, procedure, pagination, and error contracts.
