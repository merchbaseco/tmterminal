---
summary: Defines Clerk credential verification, local Access Projections, stable account ownership, repair, and background authorization.
read_when:
  - changing authentication, account identity, Clerk webhooks, API keys, OAuth, or operator authorization
  - changing Access Projection persistence, reconciliation, or user-owned background work
  - diagnosing why a locally seeded database refuses a signed-in developer, or changing the development Access Projection bootstrap
---

# Access Boundary

Clerk owns sessions, OAuth tokens, and suite-wide User API Keys.
`merchbase-access` owns stable Merchbase Users. Trademark Terminal owns its
existing account UUID, trademark data, search preferences, and operator roles.

## Request Flow

Every protected request:

1. extracts one bearer credential;
2. verifies a route-appropriate Clerk credential through
   `@merchbaseco/access@0.4.0`;
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

## Development Bootstrap

No Clerk webhook is ever delivered to a workstation or a cloud VM, so a freshly
migrated local database has no projection and every request fails before any
seeded data can be seen. `bun run db:seed:dev` therefore calls
`bootstrapDevAccessProjection` from `@merchbaseco/access/dev` first, which
applies the projection the webhook would have written for the shared Merchbase
Dev Sign-In user through this repository's own `AccessProjectionStore`. There is
no hand-written projection SQL and no override: the package refuses a production
environment, a non-loopback database, and the production Clerk issuer, and it
claims a `sourceUpdatedAt` older than any real Clerk timestamp, so a genuine
webhook or cold load always wins over the bootstrap and a revocation can never
be masked. The seeded account is that user's, and every account in a seeded
database is an operator.

The issuer must be byte-identical to the one `createClerkAuthenticator` runs
with — both read `MERCHBASE_CLERK_ISSUER` — because a projection written under a
different issuer authorizes nobody. If the bootstrap reports that a newer event
already owns the subject, delete the local database's `access_projection` and
`access_projection_receipt` rows and re-seed.

## Local Account

`account.merchbase_user_id` is the only centralized identity mapping. It is
required and unique. No request path matches email, a Clerk subject, or another
mutable identity attribute. Creating a local account is valid only after a
verified stable Merchbase User has no existing local mapping.

Trademark Terminal stores no product-specific credentials or legacy identity
mapping. Suite-wide credential creation, inspection, and retirement belong to
the Merchbase Account Center.

## Background Work

Before starting user-owned work, call local `evaluateAccess(merchbaseUserId)`.
Denied or unavailable work does not start and its product/queue data remains.
Trademark Terminal currently has no user-owned background jobs; USPTO ingestion
is global source maintenance and does not impersonate a user.
