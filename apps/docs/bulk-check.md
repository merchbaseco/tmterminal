---
title: Bulk Check
---

# Bulk Check

Enter one phrase per line. You get live exact and live partial counts for every line in one Data Version.

Each line returns a live exact count and a live partial count, ignoring punctuation the same way Multi does. Open a line to see the Search Marks hits behind those numbers.

**Singular** is on by default, as in [Check Text](/check-text). A plural line also counts singular marks: `Kitten Nuggets` counts KITTEN NUGGET as exact. The hits behind a line use the same setting, so the counts and the list agree.

**Type** narrows the counts to one mark type.

The same job in automation is `tt bulk-check`, `client.trademarks.bulkCheck`, or the HTTP `bulkCheck` procedure, with the same `singular` and `type` options. To get the matching marks for each text instead of counts, use [Check Text](/check-text)'s automation: `tt screen`, `client.trademarks.screen`, or MCP `tmterminal_screen`.

## What's next

- [Check Text](/check-text)
- [Results](/results)
- [HTTP client](/http-client)
