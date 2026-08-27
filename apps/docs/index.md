---
title: Welcome
---

# Welcome

Trademark Terminal is a trademark search and compliance tool for
print-on-demand sellers from MerchBase. Type a prospective phrase for a
t-shirt, or investigate a trademark via its serial number. Every trademark
in the database is kept up to date from USPTO's database, and all of our
results are accessible for programmatic and agentic use with a CLI and MCP.

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
