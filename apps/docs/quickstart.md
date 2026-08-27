---
title: Quickstart
---

# Quickstart

Sign in, run one search, and read the row as a record.

## Step 1: Sign in

Open [tmterminal.merchbase.co](https://tmterminal.merchbase.co/search) and sign in with a MerchBase account.

For the CLI or HTTP client, create a suite-wide API key in the [MerchBase Account Center](https://merchbase.co/account/api-keys/) and export it:

```sh
export MERCHBASE_API_KEY="your_api_key"
```

Hosted MCP uses Clerk OAuth. It rejects API keys. See [MCP](/mcp).

## Step 2: Search a mark

On the website, open [Search](https://tmterminal.merchbase.co/search) and submit `TERMINAL CLUB` as Multi, live only.

The same Search Query from a client:

::: code-group

```sh [CLI]
bun add --global @tmterminal/cli
tt auth set
tt search "TERMINAL CLUB" --status live
```

```ts [HTTP]
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

:::

`tt` requires Bun 1.3.5 or newer.

## Step 3: Read the result

A row is a trademark record, not a decision. Live and Dead follow USPTO status. A zero means this catalog did not find a live match. It does not mean the phrase is safe to print.

See [Results](/results).

## What's next

- [Search Marks](/search-marks) — Multi, Split, and Wildcard
- [Check Text](/check-text) — paste listing copy
- [CLI](/cli) — JSON envelopes and paging
- [HTTP client](/http-client) — typed procedures
- [MCP](/mcp) — hosted agent tools
- [Status](/status) — how current the catalog is
