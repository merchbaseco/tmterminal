# Trademark Turtle CLI

`tt` is the JSON-first command-line client for Trademark Turtle. It searches
United States trademarks, resolves exact identities, checks listing text, runs
reports, and reads service status.

## Install

The CLI requires Bun 1.3.5 or newer.

```sh
bun add --global @tmturtle/cli
```

Store a Trademark Turtle API key interactively in macOS Keychain:

```sh
tt auth set
```

For non-interactive setup:

```sh
printf '%s' "$TMTURTLE_API_KEY" | tt auth set --stdin
```

## Use

```sh
tt search "TURTLE CLUB" --status live
tt get --serial 60146682
tt get --registration 0146682
printf '%s' "shirt title" | tt match --stdin
tt latest
tt reports run --event published-for-opposition
tt status
```

Normal commands write one JSON envelope to stdout on success or stderr on
failure. `tt --help`, `tt help <command>`, and `tt --version` use human-readable
text.

See the [CLI reference](https://github.com/merchbaseco/tmturtle/blob/main/docs/reference/cli.md)
for command flags, authentication precedence, pagination, and error contracts.
