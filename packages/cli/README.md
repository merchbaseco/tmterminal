# Trademark Terminal CLI

`tt` is the JSON-first command-line client for Trademark Terminal. It searches
United States trademarks, resolves exact identities, checks text, and reads
service status.

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

## Use

```sh
tt search "TERMINAL CLUB" --status live
tt get --serial 60146682
tt get --registration 0146682
printf '%s' "shirt title" | tt match --stdin
tt list
tt status
```

Normal commands write one JSON envelope to stdout on success or stderr on
failure. `tt --help`, `tt help <command>`, and `tt --version` use human-readable
text.

See the [CLI reference](https://github.com/merchbaseco/tmterminal/blob/main/docs/reference/cli.md)
for command flags, authentication precedence, pagination, and error contracts.
