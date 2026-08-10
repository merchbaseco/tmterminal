# Trademark Terminal CLI Changelog

## v4.0.0 - 2026-08-10

- Focus the CLI on `get`, `search`, and `screen`; account authentication remains
  under `tt auth`.
- Screen one listing text and return each matching live trademark once, without
  source positions or caller-managed document IDs.
- Align the HTTP client's screening contract with CLI and MCP while preserving
  richer matching and bulk checking in the direct API.
- Use only the suite-wide `MERCHBASE_API_KEY` environment variable and shared
  Merchbase Keychain credential for customer authentication.
- Reject legacy Trademark Terminal keys and product-specific credential
  fallbacks.

## v3.0.0 - 2026-07-25

- Rename the service to Trademark Terminal. The CLI publishes as
  `@tmterminal/cli` and the client as `@tmterminal/http-client`.
- Rename the exported error to `TmterminalError` and the client factory to
  `createTmterminalClient`.
- Read credentials from `TMTERMINAL_API_KEY` and `TMTERMINAL_BASE_URL`, and
  store keys under the `co.merchbase.tmterminal` Keychain service. Run
  `tt auth set` once to move an existing key.

## v2.0.0 - 2026-07-24

- Use plain promise-returning client methods and one stable `TmturtleError`.
- Resolve serial and registration identities through one `get` method.
- Replace `latest` with `list` and retire generated Reports.

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
