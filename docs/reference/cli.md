---
summary: Defines the tt command surface, credential precedence, JSON envelopes, pagination, validation, and exit behavior.
read_when:
  - changing `tt` commands, flags, credential storage, JSON output, pagination, validation, or errors
  - changing public procedures exposed to shell automation
---

# CLI

`tt` is the JSON-first automation client for Trademark Turtle. Each network
command maps to one API-key-authorized procedure.

## Rules

- Resource-first, verb-second commands.
- One API page per invocation; no hidden auto-pagination.
- JSON output and no prompts for normal commands.
- No aliases or compatibility command shapes.
- No API-key management or source operations.

`--help` and `--version` are human-text exceptions.

## Authentication

```text
tt auth set --stdin [--base-url <origin>]
tt auth status
tt auth clear
```

`auth set` reads one trimmed `ttk_...` token from stdin and stores it in macOS
Keychain. Secrets never enter positional arguments, flags, config files, normal
output, or logs.

Credential precedence:

1. `TMTURTLE_API_KEY`
2. Keychain entry for the normalized base URL

Base URL precedence:

1. `TMTURTLE_BASE_URL`
2. `~/.tmturtle/config.json`
3. `https://tmturtle.merchbase.co`

An invalid selected credential fails. The CLI never falls back to another
source. `auth status` validates through `account.me` and returns origin,
credential source, key suffix, and account context without the token.

## Commands

```text
tt marks search <query> [--mode multi|split|wildcard] [--match both|exact|partial] [--status live|dead] [--type design|typeset|text|other] [--registered yes|no] [--sort relevance|newest-activity|oldest-activity] [--limit 25] [--offset 0] [--data-version <version>]
tt marks get <serial-number>
tt marks get-by-registration <registration-number>
tt marks match --text <text> [--type design|typeset|text|other]
tt marks match --stdin [--type design|typeset|text|other]
tt marks latest [--limit 25] [--offset 0] [--data-version <version>]

tt reports run --event filed --window previous-week [filters and page options] [--from YYYY-MM-DD --to YYYY-MM-DD]
tt reports run --event registered --window previous-week [filters and page options] [--from YYYY-MM-DD --to YYYY-MM-DD]
tt reports run --event published-for-opposition [filters and page options]

tt sync status
```

`--match` is valid only for Multi. Split requires at least one Unicode word
token. Wildcard without `*` is exact whole-mark search; a pattern containing `*`
requires at least three consecutive literal Unicode word characters. `%`, `_`,
and `\` remain literal. Validation fails before HTTP when the command can prove
an input is invalid.

`--text` and `--stdin` are mutually exclusive. `marks match` sends the selected
text unchanged and returns every live overlap. Spans are half-open JavaScript
UTF-16 offsets, so `text.slice(start, end)` recovers the source text. Input is
limited to 4,096 UTF-16 code units and 128 Unicode word tokens; it is rejected,
never truncated. Accepted input has no hidden candidate or result cap.

## Output

Success writes one JSON envelope and newline to stdout, nothing to stderr, and
exits `0`:

```json
{"ok":true,"data":{}}
```

Failure writes one envelope and newline to stderr, nothing to stdout, and exits
`1`:

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Local invocation and validation failures use `BAD_REQUEST`. Scripts branch on
the stable JSON code rather than an exit-code taxonomy.

## Pagination

Paged output preserves the server envelope, current data-through date, and Data
Version. Follow-up commands pass `--data-version`; changed live data returns
`CONFLICT`.

Filed and registered continuations also pass the first response's resolved
`from` and `to` through `--from` and `--to`. The CLI requires Data Version,
`from`, and `to` together so crossing a week boundary returns `CONFLICT` rather
than silently changing the report window.

External streaming and hidden pagination are outside v1.
