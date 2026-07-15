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
- [USPTO ODP registration notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal) requires a signed-in USPTO.gov account to search and download ODP datasets beginning June 18, 2026.

Authenticated `TRTYRAP` metadata returns 177 Data files: 91 members for the 1884-04-07 through 2025-12-31 generation and 86 for the generation ending 2024-12-31. The complete JSON response is retained by SHA-256. Historical 403 evidence remains retained, but it is not the current access state.

The current DOC links still return the ODP HTML application shell instead of document bytes. Those responses and the official HTML references are retained by SHA-256. No browser-session or unattended-login mechanism is inferred.

## Retained artifacts

Full ZIPs stay outside Git under `~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>`. The five retained ZIPs match their manifest byte sizes and SHA-256 values and decompress to the exact XML hashes recorded in the manifest.

The 2025 `TRTYRAP` parts were downloaded from the `fileDownloadURI` values in the retained authenticated metadata. The older annual and daily files came from the legacy MerchBase downloader cache; their original per-file URIs were not retained, so the manifest leaves them null. Parsed database rows are not fixture sources.

| Product | Filename | Proven coverage | Actions | Records |
| --- | --- | --- | --- | ---: |
| `TRTYRAP` | `apc18840407-20251231-01.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20251231-05.zip` | Official member of the generation ending 2025-12-31 | `TX` | 155,000 |
| `TRTYRAP` | `apc18840407-20241231-02.zip` | Upstream filename label only; official metadata unavailable | `TX` | 155,000 |
| `TRTDXFAP` | `apc240914.zip` | Every observed transaction date is 2024-09-14 | `NA`, `TX` | 11,012 |
| `TRTDXFAP` | `apc240925.zip` | Every observed transaction date is 2024-09-25 | `IB`, `NA`, `TX` | 38,179 |

The XML root is `trademark-applications-daily`, version `2.0`, version date `20041108`. Artifact creation timestamps, transaction-date ranges, action-group occurrences and counts, full XML hashes, and ZIP hashes are verification inputs rather than prose claims.

Generation dates prove membership only. They do not describe the maximum XML transaction date or establish annual-versus-daily precedence: `apc18840407-20251231-05.xml` contains a verified `20260128` observation and has a verified maximum transaction date of `20260402`. The retained `-01` and `-05` parts contain 155,000 unique serials each in ascending physical XML order, with disjoint observed ranges `60000001`–`60172052` and `60926995`–`72182570`. API response order and filename suffixes remain provenance, not processing semantics.

## Committed evidence

Committed files are exact `<case-file>` byte ranges, including original indentation and line endings. The manifest supplies the enclosing root/version, action-key occurrence, global record index, action-local record index, serial number, and expected presence semantics.

Evidence currently pinned:

- Full and status-only annual `TX` shapes from the same official 2025 generation and the same retained part; they are different serials, not a claimed transition sequence
- An annual `TX` observation whose transaction date is after the official generation to-date
- Annual status-only `TX`, including missing mark/owner/classification/goods groups and a present-empty correspondent
- Daily `IB`, `NA`, and `TX`
- Daily `TX` revival from status 602 to 616
- Daily `TX` publication from status 774 to 686 with the source event `PUBLISHED FOR OPPOSITION`
- Present classification-group replacement and goods text preserving brackets, double parentheses, and asterisks
- Registration and cancellation records with source-reported event descriptions

## Blocking gaps

The PRD-71 full-annual evidence gate is closed. The broader canonical-ingestion fixture gate remains closed:

- Current application-documentation and status-table DOC bytes are not retained.
- Retained daily artifacts contain no numeric Official Gazette action key.
- Registration and cancellation have real single-observation evidence, not retained multi-observation sequences.
- Cross-product annual-versus-daily claim precedence is not yet established by retained evidence. Annual metadata to-date cannot serve as the boundary.

These are evidence gaps. Do not derive annual order from suffixes or response position, equate metadata dates with transaction coverage, map unknown action keys, or promote event-history text into source-observation ordering.
