---
summary: Pins official USPTO annual and daily metadata, source bytes, and live-projection evidence.
read_when:
  - changing source discovery, artifact enumeration, XML parsing, live projection, or fixture coverage
---

# USPTO source contracts

Reviewed against official USPTO metadata and retained source bytes on 2026-07-17. The machine-readable inventory is [`fixtures/uspto/manifest.json`](../../fixtures/uspto/manifest.json); `bun run fixtures:verify` proves the metadata inventory, cached artifacts, XML structure, and every committed record.

## Official contract references

- Runtime product metadata: `GET https://api.uspto.gov/api/v1/datasets/products/<product>`, with `accept: application/json` and `x-api-key`. Pinned products are annual `TRTYRAP` / `YEARLY` and daily `TRTDXFAP` / `DAILY`.
- Bulk-download policy limits one API key to 20 downloads of the same file per year and one IP to five files per 10 seconds. Signed redirects expire after five seconds, so the data-origin request begins immediately and omits the API key. Runtime retries stop after eight consecutive persisted attempts. A process-interrupted download becomes terminally failed on restart rather than consuming another same-file request; any failed artifact blocks later downloads.
- [USPTO XML resources](https://www.uspto.gov/learning-and-resources/xml-resources) names **Trademark Applications Documentation v2.3-20250813** and **Table 1 Trademark Status Codes 20250813** as the current trademark-application contracts.
- The current [application documentation](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Trademark-Applications-Documentation-v2.3-20250813.doc) is 2,329,088 bytes with SHA-256 `96a1bcec082cad186ef3b41bb8bcb8fe970289ff0784de31c7e93e2a3780648b`. It defines raw class status `6` as Active; other raw class codes remain uninterpreted.
- The current [status table](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Table1TrademarkStatusCodes_20250813.doc) is 154,624 bytes with SHA-256 `8d251bbd5af8e18eaf269524945bfd7b9714a2ac1600669486660fc75e5d6bf6`. Its 169 entries, updated 2023-06-20, contain 124 Live, 41 Dead, and four Indifferent codes (`000`, `622`, `715`, `970`). Search policy `uspto-trademark-status-20250813` maps Indifferent, null, and unlisted future codes to `unknown`.
- The retained, directly retrievable official [Trademark Applications XML v2.0 documentation](https://www.uspto.gov/sites/default/files/products/TMDailyApp-Documentation-508.pdf) is 702,326 bytes with SHA-256 `db1211c23c2b8e206acbd5f87b02804d7d63ea3269c98e725296573a7b10406a`. It proves the XML framing and repeated record-group shapes used by the annual projection.
- The official [Trademark Applications Daily XML v2 documentation](https://www.uspto.gov/sites/default/files/products/applications-documentation.pdf) defines action key `00` as **Published for Opposition** and uses action key plus serial or registration identity for file ordering. Action keys are transport grouping metadata; each `case-file` carries the projected product data.
- [USPTO ODP registration notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal) requires a signed-in USPTO.gov account to search and download ODP datasets beginning June 18, 2026.

Authenticated `TRTYRAP` metadata returns 177 Data files: 91 members for the 1884-04-07 through 2025-12-31 baseline and 86 for the set ending 2024-12-31. The complete JSON response is retained by SHA-256. Historical 403 evidence remains retained, but it is not the current access state.

Authenticated `TRTDXFAP` discovery on 2026-07-17 returned title `Trademark Full Text XML Data (No Images) – Daily Applications`, frequency `DAILY`, catalog `lastModifiedAt` `2026-07-17T04:15:06Z`, and 562 Data files from 2025-01-01 through 2026-07-16. The 197 files after the annual baseline are exactly calendar-contiguous from 2026-01-01 through 2026-07-16, including weekends. Initial continuation starts at that boundary. Later discovery starts from the day after durable `completeThroughDate`, permits older overlap or rolled-out history, and requires every newer exact `apcYYMMDD.zip` member to remain calendar-contiguous.

Newest retained discovery evidence:

| Filename | Coverage | Bytes |
| --- | --- | ---: |
| `apc260716.zip` | 2026-07-16 | 27,737,590 |
| `apc260715.zip` | 2026-07-15 | 31,077,768 |
| `apc260714.zip` | 2026-07-14 | 53,591,215 |
| `apc260713.zip` | 2026-07-13 | 67,093,114 |
| `apc260712.zip` | 2026-07-12 | 4,960,424 |
| `apc260711.zip` | 2026-07-11 | 8,324,855 |
| `apc260710.zip` | 2026-07-10 | 27,653,037 |
| `apc260709.zip` | 2026-07-09 | 43,459,489 |
| `apc260708.zip` | 2026-07-08 | 30,408,162 |
| `apc260707.zip` | 2026-07-07 | 48,414,437 |

Authenticated manual retrieval on 2026-07-15 verified the current DOC checksums and contract facts without committing the full DOC files. The fixture verifier pins those identities and the complete disposition-map digest to the versioned policy artifact. Historical UI-link HTML responses remain retained as access-path evidence; they are not the current document identity.

## Retained artifacts

Full ZIPs stay outside Git under `~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>`. The seven retained ZIPs match their manifest byte sizes and SHA-256 values and decompress to the exact XML hashes recorded in the manifest.

The 2025 `TRTYRAP` parts were downloaded from the `fileDownloadURI` values in the retained authenticated metadata. The older annual and daily files came from the legacy MerchBase downloader cache; their original per-file URIs were not retained, so the manifest leaves them null. Parsed database rows are not fixture sources.

| Product | Filename | Proven coverage | Actions | Records |
| --- | --- | --- | --- | ---: |
| `TRTYRAP` | `apc18840407-20251231-01.zip` | Official baseline member through 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-05.zip` | Official baseline member through 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-16.zip` | Official baseline member through 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-49.zip` | Official baseline member through 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20241231-02.zip` | Upstream filename label only; official metadata unavailable | `TX` | 155,000 |
| `TRTDXFAP` | `apc240914.zip` | Every observed transaction date is 2024-09-14 | `NA`, `TX` | 11,012 |
| `TRTDXFAP` | `apc240925.zip` | Every observed transaction date is 2024-09-25 | `IB`, `NA`, `TX` | 38,179 |

The retained daily artifacts contain authentic `IB`, `NA`, and `TX` groups but no numeric Official Gazette action group. Official documentation is the evidence for `00`; an explicitly synthetic protocol-level parser test proves that transport group is not interpreted as product semantics. The fixture manifest keeps the missing authentic numeric-action evidence explicit.

The XML root is `trademark-applications-daily`, with exactly one `version-no` equal to `2.0`, version date `20041108`. Artifact creation timestamps, transaction-date ranges, action-group occurrences and counts, full XML hashes, and ZIP hashes are verification inputs rather than prose claims.

The retained `apc18840407-20251231-16.zip` contains the 3,669,744-byte `<case-file>` for serial `74668071`, word mark `GUESS JEANS`, at physical and `TX` action index 1,107. Its complete element SHA-256 is `2babb5e0e252a97051e7fe4d29dea4f518c629fabf635a8f5d5c0f61245e5b93`; the committed byte-exact source range additionally preserves its 16 leading indentation bytes.

The retained `apc18840407-20251231-49.zip` contains that artifact's 10,948,448-byte maximum `<case-file>` for serial `85951867`, word mark `IWATCH`, at physical and `TX` action index 67,098. Its complete element SHA-256 is `41b8ed8d589f4d2d19e9bd9fdf97f5dc6eedafceeb4881bad47b54ad2d7a4334`; the 10,948,464-byte committed source range additionally preserves its 16 leading indentation bytes. The record contains 26,496 `madrid-history-event` children and no Class 025 assertion. It proves the event-stream parser can validate a large physical record without projecting it.

Annual coverage dates prove baseline membership only. They do not describe the maximum XML transaction date: `apc18840407-20251231-05.xml` contains 1,107 verified 2026 transaction dates and has a verified maximum transaction date of `20260402`. Filename suffix and physical index are compact source coordinates, not chronology.

## Committed evidence

Committed files include exact `<case-file>` byte ranges and the current official XML declaration plus internal DTD prolog, preserving original indentation and line endings. The manifest supplies each record's enclosing root/version, action-key occurrence, global record index, action-local record index, serial number, and expected presence semantics.

Direct-projection evidence currently pinned:

- one authentic annual Class 025 `TX` record with mark, classes, owners, goods/services, and status history;
- one authentic annual Class 025 `TX` record whose five-digit optional class status date normalizes to null; exactly eight-digit non-calendar dates remain invalid;
- the authentic 10,948,448-byte annual record with no Class 025 assertion;
- an annual record whose transaction date is after the official baseline to-date;
- authentic daily records from `IB`, `NA`, and `TX` source groups, including sparse shapes and NA removal, plus synthetic protocol coverage for documented group `00`;
- an authentic two-file daily sequence that replaces Class 025 child collections;
- an authentic later daily full record whose replacement omits Class 025;
- strict source identity and calendar-date failures;
- fixed 100-mark projection batches.

## Live projection policy

The annual baseline selects exactly the 91 official `TRTYRAP` members covering 1884-04-07 through 2025-12-31. Every physical record is counted and validated. A non-empty `mark-identification` plus explicit `primary-code` `025` projects directly into the live tables. Zero-selected files still complete. Every successful artifact is immediately queryable; 91/91 completion advances the freshness frontier but performs no activation.

Daily continuation uses the same parser and transaction. Action keys preserve source grouping and ordering but do not control record projection. Sparse records without a word mark cannot replace live state. A complete later record with a word mark and classifications replaces an older Class 025 record; omission of Class 025 removes that live serial regardless of action group. Source transaction date prevents an older competing record from overwriting newer state.

One reconciliation handles one ZIP/XML with fixed projection batches and bounded status-event statements. Replay deletes only rows still owned by that product and filename before reapplying the artifact. Terminal ZIPs are deleted immediately.
