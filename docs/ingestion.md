---
summary: Defines USPTO source authority, artifact discovery, immutable observations, canonical projection, replay, and corpus freshness.
read_when:
  - changing USPTO discovery, downloads, parsing, projection, publication, or freshness
  - changing corpus source authority, provenance, replay, or status derivation
---

# USPTO ingestion

Trademark Turtle turns USPTO bulk artifacts into a searchable corpus without exposing source-file mechanics to callers. Raw artifacts and parsed observations are immutable; canonical marks are rebuildable materializations.

## Source authority

- `TRTYRAP` provides annual retrospective application XML.
- `TRTDXFAP` provides current-calendar-year daily application XML.
- Annual metadata coverage dates establish generation membership and completeness only. They do not bound XML transaction dates or establish observation precedence.
- Annual part suffixes, product-response position, release metadata, and physical record order are provenance, not claim precedence.
- Source authority is a partial order. A versioned policy adds an order edge only at the scope proved: official source documentation may establish a reusable profile rule; an exact retained fixture sequence establishes only its observed transition unless further evidence proves generalization.
- A transaction date may order a fixture-proven transition inside a source profile. It does not establish whole-record or cross-product authority by itself.
- Annual and daily observations have no general precedence edge. Their claims reconcile by claim path only when every admissible fold produces the same semantic value.
- Artifact or generation absence never deletes a mark. Only explicit USPTO facts change canonical state.
- Every daily ZIP remains retained after an annual generation covers its date.

`status_date` is a trademark-status fact. It is never whole-record source precedence.

## Provider access and pacing

USPTO Open Data Portal access uses one operator-managed `USPTO_API_KEY` associated with a valid USPTO.gov account. The key is a server secret. It never enters browser or client output, logs, database rows, fixtures, source manifests, or application error payloads. The operator keeps the associated ODP account profile current.

USPTO currently publishes no numeric request, download, or concurrency limit for the ODP bulk-product API and documents no stable rate-limit-header or retry contract. Numeric limits published for TSDR are a different service and do not apply to ODP. Trademark Turtle therefore does not hardcode an assumed USPTO quota.

All discovery and downloads pass through one credential-scoped scheduler. Initial artifact downloads are serial. Discovery interval, concurrency, timeouts, retry attempts, and backoff bounds remain runtime-configurable. The scheduler:

- honors `Retry-After` or reset headers when actually returned;
- pauses the provider lane and applies persisted exponential backoff with jitter after observed throttling;
- retries timeouts and server failures within a configured cap;
- stops and alerts on authentication, authorization, or permanent request failures;
- persists next eligibility, attempts, sanitized response state, and artifact verification state so restart cannot hammer USPTO;
- never advances artifact or corpus state before verified download and committed publication.

“Daily” and “annual” describe source-product cadence, not a promised publication time. Discovery is idempotent and does not assume a release hour.

The v1 worker uses one persisted `uspto-odp` lane and a PostgreSQL advisory lock, so multiple worker processes cannot issue simultaneous discovery or download calls for the credential. The lane stores retry eligibility, consecutive transient failures, sanitized response state, and terminal stop reason. Attempts remain durable; credential, permanent, and retry-exhaustion failures also create durable operator alerts. Runtime pacing is configured with `USPTO_DISCOVERY_INTERVAL_MS`, `USPTO_SCHEDULER_POLL_MS`, `USPTO_REQUEST_TIMEOUT_MS`, `USPTO_RETRY_BASE_MS`, `USPTO_RETRY_MAX_ATTEMPTS`, and `USPTO_RETRY_MAX_MS`.

Official references:

- [ODP bulk-data search API](https://data.uspto.gov/apis/bulk-data/search)
- [USPTO.gov account requirement for ODP](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal)

## Artifact identity

An artifact has two identities:

- **Logical artifact:** USPTO product plus upstream filename.
- **Artifact version:** logical artifact plus downloaded SHA-256.

Discovery timestamps, release metadata, byte size, coverage dates, and URL are observations about a logical artifact. Changed bytes under the same filename create a new immutable version. Unchanged bytes are a no-op.

Each changed discovery observation is its own persisted download queue item, so later metadata cannot overwrite an undownloaded reissue. The worker streams that observation's response into the artifact store while calculating SHA-256, then links the observation to the retained version. A repeated hash reuses the retained object and existing version; a different hash inserts one new immutable version. The database stores content-addressed object keys, never host paths.

Annual files sharing one official metadata coverage range form one generation. The product response enumerates membership but does not establish semantic part order. A generation publishes only after every enumerated part is present and valid.

The v1 authority policy pins the complete generation from 1884-04-07 through 2025-12-31 enumerated by retained metadata response SHA-256 `48e2760d6c87175969373199aa914d06e3208d6db2345a8f1647edec329ccdd5`. The source catalog does not choose by discovery or response order, co-fold older generations, or admit a newer generation without an explicit policy revision. Reissued versions of one logical artifact reconcile before their observations become eligible; superseded bytes never compete in canonical folding.

The publisher carries that metadata response's exact 91 logical-artifact identities as an unordered v1 policy set. One retained, staged version is selected automatically when it is the logical artifact's sole version; supplying that sole SHA-256 has the same automatic identity. Multiple retained versions make staging ineligible until the caller explicitly selects one SHA-256 for that candidate. The candidate snapshots required selection evidence, verified discovery identity and coverage dates, selected version SHA-256, and parse-run digest. Publication revalidates those exact facts under the corpus lock.

Artifact versions move through explicit states:

```text
discovered -> downloading -> downloaded -> verified -> parsing -> staged -> published
                                                                    \-> quarantined
```

Superseded versions remain available for provenance and replay.

## Source observations

USPTO `case-file` records are variably complete observations, not unconditional mark snapshots. Each stored source observation includes:

- Artifact version and parse run
- Physical record index and action key
- Serial number and source transaction date
- Schema version and record-shape profile
- Element/group presence
- Lossless parsed values and digest
- Parser, projection-profile, normalization, and authority-policy versions

Raw XML slices are retained for rejects and unresolved shapes. Raw ZIPs remain the full replay source.

## Canonicalization

The canonicalizer folds a caller-supplied eligible observation set for one serial number and domain group over the source-authority partial order. It never performs a generic row merge. Artifact eligibility, generation completeness, reissue selection, publication locking, corpus versions, and frontier advancement belong to the source catalog and corpus publisher.

Scalar claims distinguish:

- **Unmentioned:** preserve the prior fact or remain unknown.
- **Set:** replace the scalar with the supplied value.
- **Clear:** clear only when a versioned source profile proves that the present empty or zero value means clear.

`uspto-normalization-v1` decodes the XML entities already validated by the lossless parser and trims boundary whitespace before semantic comparison and canonical persistence. The original lexical value remains only in the immutable source observation.

Collection claims distinguish:

- **Unmentioned:** preserve the prior group.
- **Replace:** replace a present complete group, such as a classification or statement set.
- **Assert:** add a fact when the source contract is additive.

For the retained XML v2.0 profile, a present, non-empty `case-file-owners` group is **Replace**: the official v2.0 documentation defines it as containing all owner records. An absent owners group remains **Unmentioned**. A present-empty owners group returns **Unsupported Semantics** until fixture evidence proves clear semantics. Collection completeness does not make optional child fields complete, and current-owner derivation from the retained owner history is a separate versioned mapping.

Action keys and record position preserve source framing. They establish claim precedence only where the versioned source profile proves that meaning, and they do not establish record completeness. A status-only annual `TX` observation updates lifecycle facts without erasing the word mark, filing facts, owners, classes, or goods.

For observations without a proved order edge, the canonicalizer requires semantic confluence at each affected claim path:

- Unmentioned claims do not mutate the group.
- Additive assertions commute and retain fact-level provenance.
- One effective set, clear, or replacement may establish the group.
- Unordered set, clear, or replacement claims with the same normalized semantic value resolve to that value.
- Competing order-sensitive claims are unresolved when admissible folds yield different semantic values.

Resolved provenance is a contributor set, not a selected winner. For each resolved claim path it contains every observation carrying a non-dominated effective claim that establishes the output value or additive fact; group provenance is the union of those sets. Two unordered observations asserting the same value both remain contributors. Contributor references serialize by immutable source coordinate—product, artifact-version SHA-256, and physical record index—so storage order is deterministic and auditable without implying authority.

The canonicalizer returns either resolved groups with contributor sets or stable versioned unresolved diagnostics. `authority-conflict` contains the serial number, group, claim path, observations, policy version, and competing semantic values. `unsupported-semantics` contains the same source coordinates plus the unproved presence/operation and profile. Neither chooses by metadata date, release time, transaction date alone, filename, suffix, API order, physical order alone, ingestion time, database identity, or MerchBase's current row. A publication candidate containing either unresolved kind is ineligible. Diagnostic persistence, publication locking, corpus-version changes, and frontier advancement belong to the corpus publisher.

Unknown shapes and unproven clear/collection semantics do not mutate the affected canonical group. They return `unsupported-semantics` and block complete publication until supported.

Canonical provenance is group-specific. Mark presentation, application facts, registration facts, lifecycle, owners, classifications, goods/services, and prosecution history each retain their contributing source observations.

## Derived domain values

Trademark Turtle preserves raw USPTO values and derives query values through versioned maps.

- **Status:** raw status code and date plus `live | dead | unknown`.
- **Registration:** a nonzero registration number means ever registered; it is independent of current liveness.
- **Type:** `typeset = 1`, `text = 4`, `design = 2 | 3 | 5`, and `other = 0 | 6 | unknown`.
- **Class:** raw class code, class status, and class-status date remain distinct from whole-mark status.
- **Live Class 025:** the mark is live and its Class 025 classification is active.
- **Published for opposition:** the current versioned USPTO status semantic, currently associated with status code 686. It is not a claim that the legal opposition window remains open.

Goods/services retain raw type code and source text. Display cleanup is versioned and fixture-tested because brackets, double parentheses, and asterisks carry source meaning.

Date-only USPTO values use PostgreSQL `date`, not JavaScript local-time timestamps. The all-zero unknown projects to null. Other partial or zero-filled dates remain lossless in the source observation and return `unsupported-semantics` instead of rolling into invented canonical dates.

## Parsing and publication

The reader is tolerant of documented source sparsity and strict about structure.

Valid absence includes optional elements, empty tags, zero registration numbers, nullable word marks for design marks, opaque class codes such as `A` and `B`, and unknown raw codes. These values become null, unknown, or raw facts according to a versioned profile; they are not guessed.

The following quarantine an artifact version:

- Incomplete download, checksum failure, or invalid ZIP
- Malformed or truncated XML
- Unsupported root or schema version
- Ambiguous record boundaries or source order
- Missing mandatory case identity
- Unknown record-shape profile that could mutate canonical state
- Observation-count, digest, or canonical invariant failure

v1 publishes with zero unresolved record rejects. The parser stages and validates each full artifact atomically; the corpus publisher then publishes the complete eligible source set in one database transaction. A valid `data-available-code=N` artifact publishes successfully with zero records.

One durable publication candidate contains every selected member of the pinned annual generation plus every retained daily parse run, including daily observations before the annual metadata to-date. It applies no metadata cutoff or pre-cutoff gap-fill rule. Candidate identity includes the exact eligibility snapshot, canonical semantic versions, and current parent publication. Publication rejects a candidate when that parent is no longer current or when the complete current eligible artifact set differs from the snapshot, so an older or incomplete candidate cannot regress canonical state or frontiers. Staging the exact source and semantic identity already current in the corpus returns that published candidate instead of creating a redundant child. `authority-conflict` and `unsupported-semantics` diagnostics are stored on a rejected candidate; rejection and replay return only the candidate identity and diagnostic count, and change no canonical row, corpus version, or frontier.

Publication transaction:

1. Acquire the corpus publication advisory lock.
2. Revalidate the parent publication, canonical semantic versions, staged discovery, coverage, artifact version, parse-run digest, and reissue-selection evidence.
3. Stream observations in serial-number order. A bounded first pass persists any unresolved diagnostics; only a clean candidate receives a second, fixed-size set-oriented canonical write pass.
4. Replace only claim paths and complete groups established by eligible positive claims; source absence preserves existing marks and unmentioned facts.
5. Append distinct source-reported status events.
6. Update corpus state and `corpusVersion` only for query-visible changes.
7. Insert durable corpus events and call `pg_notify(eventId)`.
8. Commit.

PostgreSQL notification is wake-up only. Durable event rows are the recovery source.

Successful publication marks the selected artifact versions published in the same transaction. A staged candidate survives process restart and can be published again; a published or rejected candidate replays its durable result. Database invariant failures roll back the complete transaction.

Changed discovery reconciliation, artifact-version retention, successful parse terminalization, candidate staging, and corpus publication acquire the same transaction-scoped corpus lock. A latest pending or downloading discovery blocks staging and publication until it is retained and verified. A parse run can become eligible before a candidate snapshots the complete source set or after publication commits, never between publication revalidation and commit. Changed discovery and reissue transitions obey the same exclusion; unchanged discovery remains a persisted no-op.

## Freshness

Corpus state keeps separate facts:

- `publishedThroughDate`: newest source date represented by a successful publication.
- `completeThroughDate`: contiguous authoritative frontier with every required artifact resolved.
- `lastSuccessfulMergeAt`: wall-clock time of the last committed publication.
- `corpusVersion`: monotonic version of query-visible canonical state.

Public `corpusThroughDate` means `completeThroughDate`. A later artifact may publish beyond a gap, but the complete frontier remains behind and the service reports degraded state. A changed artifact version at or before the frontier makes completeness provisional until reconciled.

The pinned annual generation establishes the initial complete frontier at 2025-12-31. Retained daily coverage advances it only across contiguous calendar coverage; `publishedThroughDate` may move beyond a gap. `corpusVersion` advances only when canonical values or query-visible provenance change.

## Module interfaces

The ingestion implementation is hidden behind deep modules:

- **Source catalog module:** reconciles USPTO product metadata into logical artifacts and versions.
- **Artifact pipeline module:** downloads, verifies, parses, and stages one immutable version.
- **Canonicalizer module:** folds a partially ordered eligible observation set for one serial into resolved canonical groups or versioned `authority-conflict` / `unsupported-semantics` output.
- **Corpus publisher module:** stages one complete eligible source set, revalidates it under the publication lock, and atomically publishes all affected serials or durable unresolved diagnostics.
- **Reconciliation runtime:** reads database state and enqueues eligible work; jobs do not recursively chain one another.

The USPTO client is a true-external adapter. Production uses the HTTP adapter; tests use fixtures through an in-memory adapter. PostgreSQL behavior is tested through the module interface using a real test database.

## Fixture gate

Complete mixed-product corpus publication does not begin until the repository contains:

- Current USPTO application documentation, status table, and source manifest with checksums
- Official metadata enumerating one complete annual generation
- Full annual application and status-only annual `TX` fixtures
- Daily `NA`, `TX`, `IB`, and numeric Official Gazette action fixtures
- Full-to-partial, missing-versus-empty, collection replacement, revival, class cancellation, registration, and publication sequences
- Real PostgreSQL replay tests for out-of-order ingestion, reissues, idempotency, provenance, and frontier behavior

Small committed fixtures are byte-exact excerpts with their original root, version, action-key context, artifact checksum, record index, and expected observation. Full ZIPs live outside Git in a content-addressed integration cache.

The pinned inventory and current blockers live in [USPTO source contracts](specs/uspto-source-contracts.md). Retained official metadata and source bytes now prove complete 2025-generation enumeration plus byte-exact full, status-only, and post-metadata-to-date annual `TX` shapes. PRD-59 may implement folding over caller-supplied eligible observations, fixture-proven same-product transitions, semantic confluence, contributor sets, and both unresolved output kinds. Mixed-product corpus publication remains closed on unresolved annual-versus-daily conflicts; unsupported DOC, action, registration, and cancellation semantics remain unresolved under the same zero-reject publication rule.
