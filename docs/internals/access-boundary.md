---
summary: Defines Clerk credential verification, local Access Projections, stable account ownership, repair, and background authorization.
read_when:
  - changing authentication, account identity, Clerk webhooks, API keys, OAuth, or operator authorization
  - changing Access Projection persistence, reconciliation, or user-owned background work
---

# Access Boundary

Clerk owns sessions, OAuth tokens, and suite-wide User API Keys.
`merchbase-access` owns stable Merchbase Users. Trademark Terminal owns its
existing account UUID, trademark data, search preferences, and operator roles.

## Request Flow

Every protected request:

1. extracts one bearer credential;
2. verifies a route-appropriate Clerk credential through
   `@merchbaseco/access@0.2.1`;
3. resolves the known issuer and subject from the local Access Projection;
4. evaluates fixed service `tmterminal`;
5. finds or creates the local service account by stable Merchbase User ID.

`/api/trpc` accepts sessions and User API Keys. Session-only procedures still
require a session after authentication. `/api/oauth/trpc` accepts OAuth only.
There is no email lookup, credential fallback, product-specific key, or
compatibility alias.

Authentication maps to stable HTTP outcomes: 401 for an invalid or missing
credential, 403 for valid but denied access or insufficient credential kind,
and 503 when access cannot be evaluated.

## Projection

`access_projection` is keyed by Clerk issuer plus subject and uniquely maps an
active row to one Merchbase User ID. A verified `user.created` or `user.updated`
webhook applies a newer Access Profile. A verified `user.deleted` or malformed
profile writes a tombstone; it never deletes product data.

`access_projection_receipt` applies `svix-id` exactly once. Projection updates
are monotonic by `sourceUpdatedAt`. A missing projection cold-loads Clerk once;
the package bounds concurrent loads. Positive API-key verification is
invalidated on identity changes. Active projections are refreshed once daily
to repair missed webhooks or direct Clerk changes. Repair joins projections to
existing local account mappings: account mappings without a projection do not
trigger Clerk reads, and projection-only suite users do not create product
accounts.

## Local Account

`account.merchbase_user_id` is the only centralized identity mapping. The
additive migration leaves it nullable and unique. Existing accounts require an
explicit, reviewed backfill; no request path matches email or legacy Clerk ID.
Creating a local account is valid only after a verified stable Merchbase User
has no existing local mapping. Lazy creation fails closed while any legacy
account remains unmapped, so an incomplete backfill cannot recreate an existing
user's account.

The legacy Clerk identity and Trademark Terminal API-key tables remain
data-preserving migration evidence until the approved cutover has proven every
account mapping and legacy key retirement. Runtime auth does not read them.
Final not-null enforcement and table removal require a later generated
migration after those gates.

## Background Work

Before starting user-owned work, call local `evaluateAccess(merchbaseUserId)`.
Denied or unavailable work does not start and its product/queue data remains.
Trademark Terminal currently has no user-owned background jobs; USPTO ingestion
is global source maintenance and does not impersonate a user.
