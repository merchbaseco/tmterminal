---
title: Search Marks
---

# Search Marks

Search one word mark. Filtering and sorting happen on the server before the page and the count.

Open [Search](https://tmterminal.merchbase.co/search). Signed-in users get Multi, Split, and Wildcard on one rail. Serial and registration numbers are identities: type them on a [mark record](/mark-records) or `tt get`, not in this field.

```sh
tt search "TERMINAL CLUB" --status live
```

## Multi

Search the query as written.

- **Exact** means the word mark equals the query.
- **Partial** means the word mark contains the query.
- **Both** returns each set.

`--match` on the CLI is valid only for Multi.

## Split

Break a phrase into adjacent word combinations and search each combination as an exact mark. Use this when a longer listing phrase might hide a shorter claimed mark.

## Wildcard

Use `*` for unknown text inside a word mark, such as `IN * WE TRUST`. Other punctuation stays literal. A pattern that contains `*` needs at least three consecutive literal word characters.

## Filters

Status (live, dead, or all), mark type, registration, and sort apply to the whole result set before pagination. The website and the API share those controls.

## What's next

- [Results](/results)
- [Check Text](/check-text)
- [Bulk Check](/bulk-check)
- [Mark records](/mark-records)
