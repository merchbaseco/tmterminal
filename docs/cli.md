---
summary: Defines the tt CLI command surface, authentication, JSON envelopes, pagination behavior, and exit semantics.
read_when:
  - changing the tt command surface, authentication, output, pagination, or errors
  - changing the public HTTP procedures used by automation
---

# Trademark Turtle CLI

`tt` is the JSON-first automation client for Trademark Turtle. Every network command maps to one API-key-authorized procedure. The CLI searches live Class 025 data; v1 has no class selector or all-class programmatic lane.

## Contract

- Resource-first, verb-second commands
- One API page per invocation; no hidden auto-pagination
- JSON output for normal commands
- No prompts during normal commands
- No aliases or compatibility command shapes in v1
- No API-key creation, revocation, or operator ingestion controls

`--help` and `--version` are human-text exceptions.

## Authentication

```text
tt auth set --stdin [--base-url <origin>]
tt auth status
tt auth clear
```

`auth set` reads one trimmed `ttk_...` token from stdin and stores it in macOS Keychain. Secrets never enter positional arguments, flags, config files, normal output, or logs.

Credential precedence:

1. `TMTURTLE_API_KEY`
2. Keychain entry for the normalized base URL

Base URL precedence:

1. `TMTURTLE_BASE_URL`
2. `~/.tmturtle/config.json`
3. `https://tmturtle.merchbase.co`

Keychain entries are bound to normalized origin. An invalid selected credential fails; the CLI never falls back to another source. `auth status` validates through `account.me` and returns origin, credential source, key suffix, and account context without exposing the token.

## Commands

```text
tt marks search <query> [--mode multi|split|wildcard] [--match both|exact|partial] [--status live|dead] [--type design|typeset|text|other] [--registered yes|no] [--sort relevance|newest-activity|oldest-activity] [--limit 25] [--offset 0] [--data-version <version>]
tt marks get <serial-number>
tt marks get-by-registration <registration-number>
tt marks match --text <text> [--type design|typeset|text|other]
tt marks match --stdin [--type design|typeset|text|other]
tt marks latest [--limit 25] [--offset 0] [--data-version <version>]

tt reports run --event filed --window previous-week [filters and page options]
tt reports run --event registered --window previous-week [filters and page options]
tt reports run --event published-for-opposition [filters and page options]

tt sync status
```

`--match` is valid only for Multi. Split and Wildcard reject it before HTTP. Split requires at
least one Unicode word token. Wildcard queries without `*` are exact whole-mark searches; patterns
with `*` require at least three consecutive literal Unicode word characters. `%`, `_`, and `\` remain
literal. `--text` and `--stdin` are mutually exclusive.

Annual artifact state and provider diagnostics remain read-only operator capabilities outside the published CLI.

## Output

Success writes exactly one JSON envelope and newline to stdout, writes nothing to stderr, and exits `0`:

```json
{"ok":true,"data":{}}
```

Failure writes exactly one JSON envelope and newline to stderr, writes nothing to stdout, and exits `1`:

```json
{"ok":false,"error":{"code":"NOT_FOUND","message":"Trademark not found","details":{}}}
```

Local invocation and validation failures use `BAD_REQUEST`. Scripts branch on the stable JSON error code rather than a growing exit-code taxonomy.

## Pagination

Paged responses preserve the server envelope:

```json
{
  "items": [],
  "total": 0,
  "limit": 25,
  "offset": 0,
  "meta": {
    "dataThroughDate": "2026-07-13",
    "dataVersion": "123"
  }
}
```

Every sort ends with serial number as a stable tie-breaker. Continuation requests pass `--data-version`; changed live data returns `CONFLICT` instead of silently duplicating or skipping results.

External streaming is not part of the v1 CLI.
