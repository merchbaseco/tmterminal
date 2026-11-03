---
title: Bulk Check
---

# Bulk Check

Enter one phrase per line. Each phrase is a Screen Query. You get live exact and live partial counts for every line in one Data Version.

Each line returns a live exact count and a live partial count, ignoring punctuation the same way Multi does. Open a line to see the Search Marks hits behind those numbers.

**Singular** is on by default, as in [Check Text](/check-text). A plural line also counts singular marks: `Kitten Nuggets` counts KITTEN NUGGET as exact. The hits behind a line use the same setting, so the counts and the list agree.

Bulk Check is a signed-in website tool. The HTTP `screen` procedure (named queries) is the batch form. `tt screen` takes one complete listing text, not a line list. MCP `tmterminal_screen` takes one text or up to 100 named texts, and returns matching marks per text rather than counts.

## What's next

- [Check Text](/check-text)
- [Results](/results)
- [HTTP client](/http-client)
