---
title: Welcome
---

# Welcome

Trademark Terminal is MerchBase's trademark search for print-on-demand.
Type a word you would print on a shirt, paste a listing, or open a serial
number. We keep United States Class 025 current from USPTO source files
(clothing, footwear, and headgear) and we serve the same jobs on the
website, in the `tt` CLI, in `@tmterminal/http-client`, and over hosted MCP.

These docs use `TERMINAL CLUB` as the working example.

## Search

### [Search Marks](/search-marks)

Find a word mark. Multi, Split, or Wildcard.

- Exact, partial, or both
- Live and dead filters
- Serial and registration numbers are identities

### [Check Text](/check-text)

Paste listing copy. Live marks that appear as exact phrases.

### [Bulk Check](/bulk-check)

One Screen Query per line. Live exact and live partial counts.

### [CLI](/cli), [HTTP client](/http-client), [MCP](/mcp)

The same three jobs from a shell, a TypeScript app, or an agent.

## First request

```sh
tt search "TERMINAL CLUB" --status live
```

Or open [Search](https://tmterminal.merchbase.co/search) and submit the same mark.

## Next

- [Quickstart](/quickstart)
- [Sign in](/sign-in)
- [Status](/status)
- [Results](/results)
- [Class 025](/class-025)
