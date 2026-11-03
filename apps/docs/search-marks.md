---
title: Search Marks
---

# Search Marks

Search one word mark. Filtering and sorting happen on the server before the page and the count.

Open [Search](https://tmterminal.merchbase.co/search). Signed-in users get Multi, Split, and Wildcard on one rail. Serial and registration numbers are identities: type them on a [mark record](/mark-records) or `tt get`, not in this field.

```sh
tt search "TERMINAL CLUB" --status live
```

Multi, Split, Bulk Check, and text screening ignore punctuation. Apostrophes are dropped, so `it's fine` finds both IT'S FINE and ITS FINE. Other punctuation, including `%`, `&`, and `-`, separates words, so `rock-n-roll` finds ROCK N ROLL. Symbols such as `♥` and `+` still count. Wildcard keeps punctuation literal.

## Multi

Search the query as written, ignoring punctuation.

- **Exact** means the word mark equals the query.
- **Partial** means the word mark contains the query.
- **Both** returns each set.

`--match` on the CLI is valid only for Multi.

## Singular

Check **Singular** under Match, or pass `singular: true` (`--singular` on the CLI), to also match plural words as singular, on the query and the mark alike. `kitten nuggets` then finds KITTEN NUGGET as an exact match. Multi and Split take it. Search leaves it off, so it finds what you typed. Check Text and Bulk Check turn it on by default.

A word that reads as a regular plural loses its ending: `-ies` becomes `-y` (`puppies`, PUPPY), `-ches`, `-shes`, `-xes`, `-zes`, and `-sses` drop `-es`, and other `-s` words drop `-s`. Words of three letters or fewer, words ending in `-ss`, `-us`, or `-is`, and words such as `this`, `its`, `yes`, and `news` stay as they are. A final `-ie` matches `-y`, so `cookies` finds MILK AND COOKIE.

## Split

Break a phrase into adjacent word combinations and search each combination as an exact mark. Use this when a longer listing phrase might hide a shorter claimed mark.

## Wildcard

Use `*` for unknown text inside a word mark, such as `IN * WE TRUST`. Other punctuation stays literal, and Wildcard takes no `singular`. A pattern that contains `*` needs at least three consecutive literal word characters.

## Filters

Status (live, dead, or all), mark type, registration, and sort apply to the whole result set before pagination. The website and the API share those controls.

## What's next

- [Results](/results)
- [Check Text](/check-text)
- [Bulk Check](/bulk-check)
- [Mark records](/mark-records)
