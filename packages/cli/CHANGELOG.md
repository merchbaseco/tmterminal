# Trademark Turtle CLI Changelog

## v1.0.2 - 2026-07-22

- API keys entered through `tt auth set` remain hidden in real terminals.

## v1.0.1 - 2026-07-22

- `tt auth set` now opens a hidden interactive prompt, while `--stdin` remains
  available for scripts and agent workflows.

## v1.0.0 - 2026-07-22

- Search United States trademarks with Exact, Multi, Split, and Wildcard modes.
- Resolve exact serial and registration numbers, check listing text, and run
  trademark reports from scripts and agent workflows.
- Read the latest trademarks and Trademark Turtle service status as stable JSON.
- Store API keys in macOS Keychain without exposing credentials in command
  arguments or local configuration files.
- Use the companion typed HTTP client for the same search, identity, report,
  account, and status contracts in TypeScript applications.
