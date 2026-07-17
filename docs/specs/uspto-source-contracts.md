---
summary: Pins official USPTO annual metadata, source bytes, direct-projection evidence, and deferred daily gaps.
read_when:
  - changing annual discovery, artifact enumeration, XML parsing, direct projection, or fixture coverage
---

# USPTO source contracts

Reviewed against official USPTO metadata and retained source bytes on 2026-07-17. The machine-readable inventory is [`fixtures/uspto/manifest.json`](../../fixtures/uspto/manifest.json); `bun run fixtures:verify` proves the metadata inventory, cached artifacts, XML structure, and every committed record.

## Official contract references

- Runtime product metadata: `GET https://api.uspto.gov/api/v1/datasets/products/TRTYRAP`, with `accept: application/json` and `x-api-key`. The pinned product identifier is `TRTYRAP` and its frequency literal is `YEARLY`. Retained `TRTDXFAP` evidence informs a later daily design but is not a v1 worker input.
- Bulk-download policy limits one API key to 20 annual downloads of the same file and one IP to five files per 10 seconds. Signed redirects expire after five seconds, so the data-origin request begins immediately and omits the API key. Runtime retries stop after eight consecutive persisted attempts. A process-interrupted download becomes terminally failed on restart rather than consuming another same-file request; any failed member blocks later generation downloads.
- [USPTO XML resources](https://www.uspto.gov/learning-and-resources/xml-resources) names **Trademark Applications Documentation v2.3-20250813** and **Table 1 Trademark Status Codes 20250813** as the current trademark-application contracts.
- The current [application documentation](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Trademark-Applications-Documentation-v2.3-20250813.doc) is 2,329,088 bytes with SHA-256 `96a1bcec082cad186ef3b41bb8bcb8fe970289ff0784de31c7e93e2a3780648b`. It defines raw class status `6` as Active; other raw class codes remain uninterpreted.
- The current [status table](https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/Table1TrademarkStatusCodes_20250813.doc) is 154,624 bytes with SHA-256 `8d251bbd5af8e18eaf269524945bfd7b9714a2ac1600669486660fc75e5d6bf6`. Its 169 entries, updated 2023-06-20, contain 124 Live, 41 Dead, and four Indifferent codes (`000`, `622`, `715`, `970`). Search policy `uspto-trademark-status-20250813` maps Indifferent, null, and unlisted future codes to `unknown`.
- The retained, directly retrievable official [Trademark Applications XML v2.0 documentation](https://www.uspto.gov/sites/default/files/products/TMDailyApp-Documentation-508.pdf) is 702,326 bytes with SHA-256 `db1211c23c2b8e206acbd5f87b02804d7d63ea3269c98e725296573a7b10406a`. It proves the XML framing and repeated record-group shapes used by the annual projection.
- [USPTO ODP registration notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal) requires a signed-in USPTO.gov account to search and download ODP datasets beginning June 18, 2026.

Authenticated `TRTYRAP` metadata returns 177 Data files: 91 members for the 1884-04-07 through 2025-12-31 generation and 86 for the generation ending 2024-12-31. The complete JSON response is retained by SHA-256. Historical 403 evidence remains retained, but it is not the current access state.

Authenticated manual retrieval on 2026-07-15 verified the current DOC checksums and contract facts without committing the full DOC files. The fixture verifier pins those identities and the complete disposition-map digest to the versioned policy artifact. Historical UI-link HTML responses remain retained as access-path evidence; they are not the current document identity.

## Retained artifacts

Full ZIPs stay outside Git under `~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>`. The seven retained ZIPs match their manifest byte sizes and SHA-256 values and decompress to the exact XML hashes recorded in the manifest.

The 2025 `TRTYRAP` parts were downloaded from the `fileDownloadURI` values in the retained authenticated metadata. The older annual and daily files came from the legacy MerchBase downloader cache; their original per-file URIs were not retained, so the manifest leaves them null. Parsed database rows are not fixture sources.

| Product | Filename | Proven coverage | Actions | Records |
| --- | --- | --- | --- | ---: |
| `TRTYRAP` | `apc18840407-20251231-01.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-05.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-16.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-49.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20241231-02.zip` | Upstream filename label only; official metadata unavailable | `TX` | 155,000 |
| `TRTDXFAP` | `apc240914.zip` | Every observed transaction date is 2024-09-14 | `NA`, `TX` | 11,012 |
| `TRTDXFAP` | `apc240925.zip` | Every observed transaction date is 2024-09-25 | `IB`, `NA`, `TX` | 38,179 |

The XML root is `trademark-applications-daily`, with exactly one `version-no` equal to `2.0`, version date `20041108`. Artifact creation timestamps, transaction-date ranges, action-group occurrences and counts, full XML hashes, and ZIP hashes are verification inputs rather than prose claims.

The retained `apc18840407-20251231-16.zip` contains the 3,669,744-byte `<case-file>` for serial `74668071`, word mark `GUESS JEANS`, at physical and `TX` action index 1,107. Its complete element SHA-256 is `2babb5e0e252a97051e7fe4d29dea4f518c629fabf635a8f5d5c0f61245e5b93`; the committed byte-exact source range additionally preserves its 16 leading indentation bytes.

The retained `apc18840407-20251231-49.zip` contains that artifact's 10,948,448-byte maximum `<case-file>` for serial `85951867`, word mark `IWATCH`, at physical and `TX` action index 67,098. Its complete element SHA-256 is `41b8ed8d589f4d2d19e9bd9fdf97f5dc6eedafceeb4881bad47b54ad2d7a4334`; the 10,948,464-byte committed source range additionally preserves its 16 leading indentation bytes. The record contains 26,496 `madrid-history-event` children and no Class 025 assertion. It proves the event-stream parser can validate a large physical record without projecting it.

Generation dates prove membership and the activation frontier only. They do not describe the maximum XML transaction date: `apc18840407-20251231-05.xml` contains 1,107 verified 2026 transaction dates and has a verified maximum transaction date of `20260402`. Filename suffix and physical index are compact source coordinates, not chronology.

## Committed evidence

Committed files include exact `<case-file>` byte ranges and the current official XML declaration plus internal DTD prolog, preserving original indentation and line endings. The manifest supplies each record's enclosing root/version, action-key occurrence, global record index, action-local record index, serial number, and expected presence semantics.

Direct-projection evidence currently pinned:

- one authentic annual Class 025 `TX` record with mark, classes, owners, goods/services, and status history;
- one authentic annual Class 025 `TX` record whose five-digit optional class status date normalizes to null; exactly eight-digit non-calendar dates remain invalid;
- the authentic 10,948,448-byte annual record with no Class 025 assertion;
- an annual record whose transaction date is after the official generation to-date;
- strict source identity and calendar-date failures;
- fixed 100-mark projection batches.

## Annual activation policy

The corpus selects exactly the 91 official `TRTYRAP` members covering 1884-04-07 through 2025-12-31. Every physical record is counted and validated. Only a non-empty `mark-identification` plus explicit `primary-code` `025` is projected. Zero-selected members remain complete members. One reconciliation handles one ZIP/XML and fixed projection batches; terminal ZIPs are deleted immediately. Exactly 91/91 complete members activate the generation and set both frontiers to 2025-12-31.

## Deferred daily contract

The v1 worker does not discover, download, parse, quarantine, retain, or publish `TRTDXFAP`. Retained daily fixtures remain research evidence only. Before daily support, define Class 025 add/remove semantics, sparse update behavior, action-key support, and annual-versus-daily precedence from official evidence. Do not infer those rules from filename, response order, generation metadata, or event text.
