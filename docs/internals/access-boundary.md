---
summary: Defines Cloudflare verification, local identity projections, stable account ownership, and development authentication.
read_when:
  - changing authentication, API keys, OAuth, or operator authorization
  - changing access projections, snapshots, or local development authentication
---

# Access Boundary

Cloudflare Access owns browser sessions, OAuth access tokens, and service-token
verification. Merchbase Access owns stable Merchbase users and product grants.
Trademark Terminal owns its account UUIDs, trademark data, preferences, and
operator roles.

## Requests

The raw Host selects the verifier. `tmterminal.merchbase.co` accepts the
interactive audience and creates session context. `tmterminal-api.merchbase.co`
accepts the suite API audience: people receive OAuth context and bound customer
machines receive API-key context. Both use `/api/trpc`. Public API callers cannot
use preferences or operator procedures, even when they are people. Hosted MCP
on the API host accepts people only. Unknown hosts and caller-supplied
`x-merchbase-user-id` are rejected. Forwarded host headers do not select authority.

The origin verifies `CF-Access-Jwt-Assertion` cryptographically with the selected
audience, resolves a local identity projection, evaluates service `tmterminal`,
and finds the existing account by stable Merchbase user ID. Account ownership
never depends on email or an external subject. Interactive writes also require
the same production origin. `/api/session` is the browser bootstrap; browser API
requests use same-origin cookies. Logout uses `/cdn-cgi/access/logout`.

The exact public health routes remain anonymous. Invalid authentication returns
401, denied grants or credential kinds return 403, and unavailable grant state
returns 503. The native-header HTTP client disables redirects so Cloudflare
service-token secrets cannot be forwarded to another host.

## Projection delivery

`access_projection` has an issuer/subject primary key and a nonunique stable-user
lookup index. Several Cloudflare identity aliases can belong to the same stable
user. The canonical grant is the row whose issuer is
`https://access-internal.merchbase.co` and whose subject is the stable user ID.
`account.merchbase_user_id` remains unique. Migration 0031 removes the old
one-alias-per-user restriction without changing account IDs or product data.

A cold identity loads a snapshot from the authority through the product's own
native Cloudflare service credential. Warm requests evaluate the stored grant
locally. Snapshot updates are monotonic and receipt-deduplicated; a stale grant
cannot undo a newer revocation. The receiver is exactly
`POST https://tmterminal-internal.merchbase.co/api/internal/access-snapshot`,
protected by its unique audience and the authority service client ID. Other
routes on that host are refused. The authority owns delivery retries and daily
repair; the product does not poll the identity provider.

## Development

`createDevCloudflareAccess` from `@merchbaseco/access/dev` supplies a deterministic
local principal and applies the development projection through the same store.
The pure target guard runs before automatic migration or seeding and refuses
anything except explicit development with a loopback database. Ordinary local
development does not resolve production Cloudflare secrets or audiences.

Trademark Terminal has no user-owned background jobs. USPTO ingestion is global
source maintenance and does not impersonate a user. Any future user-owned job
must evaluate the canonical grant locally before work starts.
