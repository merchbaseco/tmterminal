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

- Flat, task-first commands for the common trademark workflows.
- One API page per invocation; no hidden auto-pagination.
- JSON output and no prompts for normal commands.
- No aliases or compatibility command shapes.
- No API-key management or source operations.

`--help` and `--version` are human-text exceptions.

## Authentication

```text
tt [--base-url <origin>] auth set
tt [--base-url <origin>] auth set --stdin
tt auth status
tt auth clear
```

`auth set` prompts for one hidden `ttk_...` token and stores it in macOS
Keychain. `--stdin` selects non-interactive input for scripts. Secrets never
enter positional arguments, flags, config files, normal output, or logs.

Credential precedence:

1. `TMTURTLE_API_KEY`
2. Keychain entry for the normalized base URL

Base URL precedence:

1. Global `--base-url <origin>`
2. `TMTURTLE_BASE_URL`
3. `https://tmturtle.merchbase.co`

An invalid selected credential fails. The CLI never falls back to another
source. `auth status` validates through `account.me` and returns origin,
credential source, key suffix, and account context without the token.

## Commands

```text
tt search <query> [--mode multi|split|wildcard] [--match both|exact|partial] [--status all|live|dead] [--type all|design|typeset|text|other] [--registered all|yes|no] [--sort relevance|newest-activity|oldest-activity] [--offset 0] [--data-version <version>]
tt get --serial <eight-digit-number>
tt get --registration <seven-digit-number>
tt match --text <text> [--type all|design|typeset|text|other]
tt match --stdin [--type all|design|typeset|text|other]
tt list [--offset 0] [--data-version <version>]
tt status
```

`--match` is valid only for Multi. Split requires at least one Unicode word
token. Wildcard without `*` is exact whole-mark search; a pattern containing `*`
requires at least three consecutive literal Unicode word characters. `%`, `_`,
and `\` remain literal. Validation fails before HTTP when the command can prove
an input is invalid.

`--text` and `--stdin` are mutually exclusive. `match` sends the selected
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

Paged output preserves the server envelope and Data Version. Follow-up commands
pass `--data-version`; changed live data returns `CONFLICT`.

Every command requests the fixed 25-item API page. External streaming and
hidden pagination are outside v1.
