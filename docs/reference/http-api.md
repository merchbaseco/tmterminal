---
summary: Defines Trademark Turtle procedure groups, authorization, search, matching, screening, pagination metadata, account actions, and stable error codes.
read_when:
  - changing tRPC routes, auth requirements, search, matching, screening, pagination, account procedures, or errors
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
| Aggregate `/api/status` | Anonymous. |
| Trademark reads | Clerk session or API key. |
| Safe sync status | Clerk session or API key. |
| Account identity | Clerk session or API key. |
| API-key list, create, revoke | Clerk session. |
| Operator source status and artifact pages | Clerk session plus operator role. |
| `/api/health` | Anonymous; process and database readiness only. |

## Trademarks

The published client uses the customer-facing `trademarks` namespace. It maps
to the service's internal `marks` procedures without exposing those transport
names to callers.

| Procedure | Contract |
| --- | --- |
| `marks.search` | Multi, Split, or Wildcard query; status/type/registration filters; relevance or activity sort; server count and a 25-, 50-, or 100-item page. |
| `marks.get` | Exactly one eight-digit serial or seven-digit registration identity. |
| `marks.match` | One to 100 named Text Documents; every overlapping occurrence, half-open UTF-16 span, and live trademark group; each document is limited to 4,096 UTF-16 units and 128 Unicode word tokens. |
| `marks.screen` | One to 100 named Screen Queries; ordered live exact and partial counts in one Data Version. |
| `marks.list` | Recent source transaction activity with stable pagination. |

## Sync

The published client's top-level `status` procedure maps to `sync.status` and
returns the authenticated safe summary used by `tt status`:
worker activity, Latest Processed, Data Version, last successful update, and
pending/failed counts. A worker heartbeat older than five minutes reports a
failed active state. The summary does not expose filenames or repair actions.

Serial and registration are identities, never fuzzy query terms.

## Pagination

Filtering, sorting, count, and offset happen on the server. Paged responses use:

```json
{
  "items": [],
  "total": 0,
  "limit": 25,
  "offset": 0,
  "meta": {
    "dataVersion": "123"
  }
}
```

Continuation requests may pass the expected Data Version. A material live-data
change returns `CONFLICT` instead of silently duplicating or skipping rows.

Source-file coverage is not query metadata. Reads always use the perpetual live
trademark tables; Data Version protects continuation requests from material
changes while paging.

## Account

| Procedure | Contract |
| --- | --- |
| `account.me` | Validate the selected credential and return safe account/key context. |
| `account.api-keys.list` | Usable keys with name, suffix, creation, and last use. |
| `account.api-keys.create` | Create a named key and return its raw token exactly once. |
| `account.api-keys.revoke` | Idempotently revoke one owned key and return its ID. |
| `account.preferences.get` | Return the account's match, status, type, registration, and sort defaults plus result density and results-per-load preference. |
| `account.preferences.update` | Replace the complete validated search preference document. New searches inherit these defaults only when their URL does not provide an explicit value. |

API-key token shape is `ttk_<key-id>_<secret>`. The database stores only the
secret hash and display suffix. Verification uses timing-safe comparison;
last-used updates are coalesced. Revocation hides the key from account reads and
retains an internal tombstone so the old credential remains invalid.

## Source Operations

`GET /api/status` returns Latest Processed, 30 days of new trademark
applications and latest application updates, the aggregate Class 025 catalog
total, the earliest non-null catalog filing date, and quiet current work. It
exposes no issue details, source-file ledger, credentials, or repair actions.

Current private operator procedures are `ops.sync.status` and
`ops.sync.artifacts`. They return Latest Processed, trademark activity, catalog
totals, active issues, current work, provider state, and stable read-only
source-file pages. Artifact pages retain their per-file source-record and
projected-mark counts. The procedures have no mutation or Repair procedure yet
and are not exported by the public HTTP client or CLI.

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

- `createTmturtleClient({ apiKey, baseUrl?, fetch? })`
- `TmturtleClient`
- named input and output types for each public method
- `TmturtleError`

Client methods return promises directly. tRPC procedure objects and transport
verbs are not part of the package contract. The client and CLI ship in lockstep
SemVer.
