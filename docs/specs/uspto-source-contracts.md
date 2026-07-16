---
summary: Pins official USPTO trademark source references, retained artifact provenance, fixture evidence, and blocking gaps.
read_when:
  - changing USPTO product discovery, artifact enumeration, XML parsing, action profiles, or fixture coverage
  - deciding whether the canonical-ingestion fixture gate has enough official source evidence
---

# USPTO source contracts

Reviewed against official USPTO metadata and retained source bytes on 2026-07-15. The machine-readable inventory is [`fixtures/uspto/manifest.json`](../../fixtures/uspto/manifest.json); `bun run fixtures:verify` proves the metadata inventory, cached artifacts, XML structure, and every committed record.

## Official contract references

- Product metadata: `GET https://api.uspto.gov/api/v1/datasets/products/TRTYRAP` and `GET https://api.uspto.gov/api/v1/datasets/products/TRTDXFAP`, with `accept: application/json` and `x-api-key`.
- [USPTO XML resources](https://www.uspto.gov/learning-and-resources/xml-resources) names **Trademark Applications Documentation v2.3-20250813** and **Table 1 Trademark Status Codes 20250813** as the current trademark-application contracts.
- The current [application documentation](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Trademark-Applications-Documentation-v2.3-20250813.doc) is 2,329,088 bytes with SHA-256 `96a1bcec082cad186ef3b41bb8bcb8fe970289ff0784de31c7e93e2a3780648b`. It defines raw class status `6` as Active; other raw class codes remain uninterpreted.
- The current [status table](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Table1TrademarkStatusCodes_20250813.doc) is 154,624 bytes with SHA-256 `8d251bbd5af8e18eaf269524945bfd7b9714a2ac1600669486660fc75e5d6bf6`. Its 169 entries, updated 2023-06-20, contain 124 Live, 41 Dead, and four Indifferent codes (`000`, `622`, `715`, `970`). Search policy `uspto-trademark-status-20250813` maps Indifferent, null, and unlisted future codes to `unknown`.
- The retained, directly retrievable official [Trademark Applications XML v2.0 documentation](https://www.uspto.gov/sites/default/files/products/TMDailyApp-Documentation-508.pdf) is 702,326 bytes with SHA-256 `db1211c23c2b8e206acbd5f87b02804d7d63ea3269c98e725296573a7b10406a`. It defines transaction date as the daily process date, documents action key `00`, defines action-key/identity order as file sequence, and defines a present `case-file-owners` group as containing all owner records. These statements prove source framing and v2.0 owner-group completeness, not annual-versus-daily authority.
- [USPTO ODP registration notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal) requires a signed-in USPTO.gov account to search and download ODP datasets beginning June 18, 2026.

Authenticated `TRTYRAP` metadata returns 177 Data files: 91 members for the 1884-04-07 through 2025-12-31 generation and 86 for the generation ending 2024-12-31. The complete JSON response is retained by SHA-256. Historical 403 evidence remains retained, but it is not the current access state.

Authenticated manual retrieval on 2026-07-15 verified the current DOC checksums and contract facts without committing the full DOC files. The fixture verifier pins those identities and the complete disposition-map digest to the versioned policy artifact. Historical UI-link HTML responses remain retained as access-path evidence; they are not the current document identity.

## Retained artifacts

Full ZIPs stay outside Git under `~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>`. The six retained ZIPs match their manifest byte sizes and SHA-256 values and decompress to the exact XML hashes recorded in the manifest.

The 2025 `TRTYRAP` parts were downloaded from the `fileDownloadURI` values in the retained authenticated metadata. The older annual and daily files came from the legacy MerchBase downloader cache; their original per-file URIs were not retained, so the manifest leaves them null. Parsed database rows are not fixture sources.

| Product | Filename | Proven coverage | Actions | Records |
| --- | --- | --- | --- | ---: |
| `TRTYRAP` | `apc18840407-20251231-01.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-05.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-16.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20241231-02.zip` | Upstream filename label only; official metadata unavailable | `TX` | 155,000 |
| `TRTDXFAP` | `apc240914.zip` | Every observed transaction date is 2024-09-14 | `NA`, `TX` | 11,012 |
| `TRTDXFAP` | `apc240925.zip` | Every observed transaction date is 2024-09-25 | `IB`, `NA`, `TX` | 38,179 |

The XML root is `trademark-applications-daily`, version `2.0`, version date `20041108`. Artifact creation timestamps, transaction-date ranges, action-group occurrences and counts, full XML hashes, and ZIP hashes are verification inputs rather than prose claims.

The retained `apc18840407-20251231-16.zip` contains the 3,669,744-byte `<case-file>` for serial `74668071`, word mark `GUESS JEANS`, at physical and `TX` action index 1,107. Its complete element SHA-256 is `2babb5e0e252a97051e7fe4d29dea4f518c629fabf635a8f5d5c0f61245e5b93`; the committed byte-exact source range additionally preserves its 16 leading indentation bytes. The official format permits variable-length repeated groups and documents no case-file ceiling. Parser v4 therefore uses an evidence-backed 4,194,304-byte operational bound while retaining a hard limit against malformed unclosed records; rejected evidence remains bounded by the limit plus one 65,536-byte input slice.

Generation dates prove membership only. They do not describe the maximum XML transaction date or establish annual-versus-daily precedence: `apc18840407-20251231-05.xml` contains 1,107 verified 2026 transaction dates, including the committed `20260128` observation, and has a verified maximum transaction date of `20260402`. The retained `-01` and `-05` parts contain 155,000 unique serials each in ascending physical XML order, with disjoint observed ranges `60000001`–`60172052` and `60926995`–`72182570`. API response order, filename suffixes, release metadata, and physical order remain provenance, not processing semantics.

## Committed evidence

Committed files include exact `<case-file>` byte ranges and the current official XML declaration plus internal DTD prolog, preserving original indentation and line endings. The manifest supplies each record's enclosing root/version, action-key occurrence, global record index, action-local record index, serial number, and expected presence semantics.

Evidence currently pinned:

- Full and status-only annual `TX` shapes from the same official 2025 generation and the same retained part; they are different serials, not a claimed transition sequence
- Sparse annual `TX` and daily `IB` shapes with independently absent mark, statement, classification, or owner groups
- An annual `TX` observation whose transaction date is after the official generation to-date
- Annual status-only `TX`, including missing mark/owner/classification/goods groups and a present-empty correspondent
- Daily `IB`, `NA`, and `TX`
- Daily `TX` revival from status 602 to 616
- Daily `TX` publication from status 774 to 686 with the source event `PUBLISHED FOR OPPOSITION`
- Present classification-group replacement and goods text preserving brackets, double parentheses, and asterisks
- Registration and cancellation records with source-reported event descriptions
- XML v2.0 owner-group replacement when the group is present and non-empty; absence remains unmentioned and present-empty returns `unsupported-semantics`

The daily before/after fixtures prove only their named same-product transitions. No retained fixture observes the same serial and group in both `TRTYRAP` and `TRTDXFAP`, and the official metadata does not define a product winner. The safe PRD-59 contract is therefore the partial-order and semantic-confluence rule in [ADR 0002](../adr/0002-model-uspto-records-as-ordered-claims.md), not a total annual/daily order. Identical unordered claims resolve with all non-dominated observations retained as contributors; they do not manufacture a provenance conflict.

## First publication policy

The first corpus publication selects exactly the 91 official `TRTYRAP` members covering 1884-04-07 through 2025-12-31. Parser `uspto-application-xml-v4` validates and physically counts every record, while persisting an observation only for an explicit `primary-code` `025` plus non-empty `mark-identification`. Zero-selected members remain valid policy members. It excludes every `TRTDXFAP` artifact and sets `completeThroughDate` to 2025-12-31. The 91-member set is completeness metadata, never an execution batch: one exclusive reconciliation handles one streamed artifact and fixed observation batches. Daily metadata remains durable and operator-visible; supported selected observations and quarantine evidence remain durable. Terminal raw ZIPs are deleted, and later policy work re-downloads official bytes. This bootstrap is reversible and does not establish cross-product precedence or supersession.

## Blocking gaps

The PRD-71 full-annual evidence gate is closed. The broader canonical-ingestion fixture gate remains blocked:

- Current application/status DOC bytes are not retained; only the pinned search-policy/class-status facts, complete disposition digest, and document identities are executable evidence.
- Retained production daily evidence includes documented action key `00` full records and valid sparse/status-only `TX` records that the current parser does not yet accept. Those are parser-profile gaps, not evidence that the records are invalid.
- Retained daily artifacts still contain no numeric Official Gazette action-key fixture; action key `00` does not close that distinct evidence gap.
- Registration and cancellation have real single-observation evidence, not retained multi-observation sequences.
- Cross-product annual-versus-daily claim precedence is not established by retained evidence. Annual metadata to-date cannot serve as the boundary; order-sensitive overlaps remain authority conflicts and block mixed-product publication.
- Class-absent daily updates and Class 025 add, remove, or re-add membership need a later daily-policy contract; v3 does not infer membership across records.

The action-key `00` and sparse/status-only `TX` parser gaps require a distinct daily-lane follow-up after first publication. Invalid duplicate top-level containers remain quarantined. Do not derive annual order from suffixes or response position, equate metadata dates with transaction coverage, map unknown action keys, or promote event-history text into source-observation ordering.
