---
title: Check Text
---

# Check Text

Paste listing copy. Trademark Terminal finds live marks that appear as exact phrases in that text.

Click a highlighted phrase to filter the list to the marks behind it.

**Singular** is on by default. Plural words also match singular marks, so `Kitten Nuggets` finds KITTEN NUGGET and `Milk and Cookies` finds MILK AND COOKIE. It only adds matches. Uncheck it to match the words as written. The API, CLI, and MCP take the same `singular` option, also on by default.

**Type** narrows the marks to one mark type, the same filter Search uses.

Check Text is a signed-in website tool. The same job in automation is `tt screen`, `client.trademarks.screen`, or MCP `tmterminal_screen`: each matching live trademark once, without source positions. All three take one text or several named texts, and the same `singular` and `type` options. The richer HTTP `match` call keeps named documents and occurrence spans.

Input is limited. Over-long text is rejected, not truncated.

## What's next

- [Bulk Check](/bulk-check)
- [Results](/results)
- [CLI](/cli)
- [HTTP client](/http-client)
