---
summary: Defines Trademark Turtle procedure groups, authorization, search and report inputs, pagination metadata, account actions, and stable error codes.
read_when:
  - changing tRPC routes, auth requirements, search or report inputs, pagination, account procedures, or errors
  - changing the generated HTTP client or a downstream consumer's typed contract
---

# HTTP API

One tRPC router defines the service contract. Inputs and outputs flow into
`@tmturtle/http-client`; clients do not duplicate DTOs.

This page describes the executable contract on `origin/main`. Target-only source
status and Repair behavior stays in product and ingestion docs until the
implementation changes the router.

## Authorization

| Procedures | Credential |
| --- | --- |
| Trademark reads | Clerk session or API key. |
| Safe sync status | Clerk session or API key. |
| Account identity | Clerk session or API key. |
| API-key list, create, revoke | Clerk session. |
| Operator source status and artifact pages | Clerk session plus operator role. |
| `/api/health` | Anonymous; process and database readiness only. |

## Marks

| Procedure | Contract |
| --- | --- |
| `marks.search` | Multi, Split, or Wildcard query; status/type/registration filters; relevance or activity sort; server count and page. |
| `marks.get` | Exact eight-digit serial identity. |
| `marks.get-by-registration` | Exact normalized registration identity. |
| `marks.match-text` | All overlapping live candidates and half-open UTF-16 spans; input limit 4,096 UTF-16 units and 128 Unicode word tokens; no accepted-input result cap. |
| `marks.latest` | Recent source transaction activity with stable pagination. |

## Sync

`sync.status` returns the authenticated safe summary used by `tt sync status`:
active state, complete-through date, Data Version, degradation and staleness
facts, last successful update, and pending/failed counts. It does not expose
filenames or repair actions.

Serial and registration are identities, never fuzzy query terms.

## Reports

`reports.run` accepts one typed constraint:

- filed during previous week;
- registered during previous week;
- currently published for opposition.

The first two return resolved Monday-through-Sunday `from` and `to` dates.
Reports use the same filters, items, count, and paging behavior as search, with
`newest-activity` or `oldest-activity` sorting. Continuation supplies expected
Data Version, `from`, and `to` together so a week-boundary change returns
`CONFLICT`.

## Pagination

Filtering, sorting, count, and offset happen on the server. Paged responses use:

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

Continuation requests may pass the expected Data Version. A material live-data
change returns `CONFLICT` instead of silently duplicating or skipping rows.

The accepted ingestion redesign removes `dataThroughDate` when its API migration
lands. Until then, clients preserve the current field.

## Account

| Procedure | Contract |
| --- | --- |
| `account.me` | Validate the selected credential and return safe account/key context. |
| `account.api-keys.list` | Name, suffix, creation, last use, and status. |
| `account.api-keys.create` | Create a named key and return its raw token exactly once. |
| `account.api-keys.revoke` | Idempotently revoke one key owned by the account. |

API-key token shape is `ttk_<key-id>_<secret>`. The database stores only the
secret hash and display suffix. Verification uses timing-safe comparison;
revoked rows remain for audit and last-used updates are coalesced.

## Source Operations

Current private operator procedures are `ops.sync.status` and
`ops.sync.artifacts`. They return worker/provider summary and stable read-only
source-file pages. They have no mutation or Repair procedure yet and are not
exported by the public HTTP client or CLI.

## Errors

Stable codes:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `BAD_REQUEST`
- `NOT_FOUND`
- `CONFLICT`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `SERVICE_UNAVAILABLE`
- `INTERNAL_ERROR`

`SERVICE_UNAVAILABLE` describes a service dependency failure. It never means
that source ingestion is incomplete.

## HTTP Client

`@tmturtle/http-client` exports:

- `createTmturtleClient({ baseUrl, apiKey })`
- `TmturtleClient`
- `TmturtleRouterInputs`
- `TmturtleRouterOutputs`

The client and CLI ship in lockstep SemVer.
