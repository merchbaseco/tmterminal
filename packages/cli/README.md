# Trademark Terminal CLI

`tt` is the JSON-first command-line client for Trademark Terminal. It searches
United States trademarks, resolves exact identities, and screens listing text.

## Install

The CLI requires Bun 1.3.5 or newer.

```sh
bun add --global @tmterminal/cli
```

Store a suite-wide Merchbase API key in the shared macOS Keychain entry:

```sh
tt auth set
```

For non-interactive setup:

```sh
printf '%s' "$MERCHBASE_API_KEY" | tt auth set --stdin
```

Credential precedence is `MERCHBASE_API_KEY`, then the shared Keychain item
(`co.merchbase.cli` / `api-key`). Base URL precedence is `--base-url`, then
`TMTERMINAL_BASE_URL`, then `https://tmterminal.merchbase.co`. An invalid
selected credential fails. The CLI never falls back to another source.

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

`--match` is valid only for Multi. Wildcard patterns that contain `*` need at
least three consecutive literal word characters. `--text` and `--stdin` are
mutually exclusive. Search requests one 25-item page. Follow-up pages pass
`--data-version`; changed live data returns `CONFLICT`.

Normal commands write one JSON envelope to stdout on success or stderr on
failure:

```json
{"ok":true,"data":{}}
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Success exits `0`. Failure exits `1`. Scripts branch on the stable JSON code.
`tt --help`, `tt help <command>`, and `tt --version` use human-readable text.
