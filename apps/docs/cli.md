---
title: CLI
---

# CLI

`tt` is the JSON-first command-line client. It searches, resolves exact identities, and screens listing text. Normal commands write one JSON envelope. Scripts branch on the stable error code, not on human text.

Requires Bun 1.3.5 or newer.

## Install

```sh
bun add --global @tmterminal/cli
tt auth set
```

Non-interactive:

```sh
printf '%s' "$MERCHBASE_API_KEY" | tt auth set --stdin
```

Credential precedence is `MERCHBASE_API_KEY`, then the shared macOS Keychain item (`co.merchbase.cli` / `api-key`). Base URL precedence is `--base-url`, then `TMTERMINAL_BASE_URL`, then `https://tmterminal.merchbase.co`. An invalid selected credential fails. There is no fallback to another source.

## First request

```sh
tt search "TERMINAL CLUB" --status live
```

```sh
tt get --serial 60146682
printf '%s' "shirt title" | tt screen --stdin
printf '%s\n' "Kitten Nuggets" "Ocean Supply" | tt bulk-check --stdin
```

## Commands

```text
tt search <query> [--mode multi|split|wildcard] [--match both|exact|partial]
  [--status all|live|dead] [--type all|design|typeset|text|other]
  [--registered all|yes|no] [--singular]
  [--sort relevance|newest-activity|oldest-activity]
  [--offset 0] [--data-version <version>]
tt get --serial <eight-digit-number>
tt get --registration <seven-digit-number>
tt screen --text <text> [--text <text> ...] [--type all|design|typeset|text|other]
  [--no-singular]
tt screen --stdin [--type all|design|typeset|text|other] [--no-singular]
tt bulk-check --phrase <phrase> [--phrase <phrase> ...]
  [--type all|design|typeset|text|other] [--no-singular]
tt bulk-check --stdin [--type all|design|typeset|text|other] [--no-singular]
```

`--match` is valid only for Multi. `--singular` also matches plural words as singular and is valid for Multi and Split. `tt screen` and `tt bulk-check` match singulars unless you pass `--no-singular`. Repeat `--text` to screen several texts in one call; they come back as `texts` with ids `1`, `2`, and so on. `tt bulk-check` takes one phrase per `--phrase`, or one per stdin line, and returns live exact and partial counts per phrase. `--text` or `--phrase` and `--stdin` are mutually exclusive. Search returns one 25-item page. Follow-up pages pass `--data-version`. Changed live data returns `CONFLICT`.

## Output

```json
{"ok":true,"data":{}}
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Success exits `0`. Failure exits `1`. `tt --help` and `tt --version` are human-readable exceptions.

Flags, envelopes, and errors in detail live in the [package README](https://github.com/merchbaseco/tmterminal/blob/main/packages/cli/README.md) and the [CLI reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/cli.md).

## What's next

- [HTTP client](/http-client)
- [MCP](/mcp)
- [Search Marks](/search-marks)
- [Results](/results)
