---
title: CLI
---

# CLI

`tt` is the JSON-first command-line client. It searches, resolves exact identities, and screens listing text. Normal commands write one JSON envelope. Scripts branch on the stable error code, not on human text.

Requires Bun 1.3.5 or newer.

## Install

```sh
bun add --global @tmterminal/cli
```

```sh
tt auth set
```

Non-interactive:

```sh
printf '%s' "$MERCHBASE_API_KEY" | tt auth set --stdin
```

Credential precedence is `MERCHBASE_API_KEY`, then the shared macOS Keychain item (`co.merchbase.cli` / `api-key`). Base URL precedence is `--base-url`, then `TMTERMINAL_BASE_URL`, then `https://tmterminal.merchbase.co`. An invalid selected credential fails. There is no fallback to another source.

## Use

```sh
tt search "TERMINAL CLUB" --status live
tt get --serial 60146682
tt get --registration 0146682
printf '%s' "shirt title" | tt screen --stdin
```

```text
tt search <query> [--mode multi|split|wildcard] [--match both|exact|partial]
  [--status all|live|dead] [--type all|design|typeset|text|other]
  [--registered all|yes|no] [--sort relevance|newest-activity|oldest-activity]
  [--offset 0] [--data-version <version>]
tt get --serial <eight-digit-number>
tt get --registration <seven-digit-number>
tt screen --text <text> [--type all|design|typeset|text|other]
tt screen --stdin [--type all|design|typeset|text|other]
```

`--match` is valid only for Multi. `--text` and `--stdin` are mutually exclusive. Search returns one 25-item page. Follow-up pages pass `--data-version`. Changed live data returns `CONFLICT`.

## Output

```json
{"ok":true,"data":{}}
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Success exits `0`. Failure exits `1`. `tt --help` and `tt --version` are human-readable exceptions.

Flags, envelopes, and errors in detail live in the [package README](https://github.com/merchbaseco/tmterminal/blob/main/packages/cli/README.md) and the [CLI reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/cli.md).
