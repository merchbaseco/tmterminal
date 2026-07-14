---
summary: Pins official USPTO trademark source references, retained artifact provenance, fixture evidence, and blocking gaps.
read_when:
  - changing USPTO product discovery, artifact enumeration, XML parsing, action profiles, or fixture coverage
  - deciding whether the canonical-ingestion fixture gate has enough official source evidence
---

# USPTO source contracts

Reviewed against official USPTO surfaces and retained source bytes on 2026-07-14. The machine-readable inventory is [`fixtures/uspto/manifest.json`](../../fixtures/uspto/manifest.json); `bun run fixtures:verify` proves every committed record against its full cached ZIP.

## Official contract references

- Product metadata: `GET https://api.uspto.gov/api/v1/datasets/products/TRTYRAP` and `GET https://api.uspto.gov/api/v1/datasets/products/TRTDXFAP`, with `accept: application/json` and `x-api-key`.
- [USPTO XML resources](https://www.uspto.gov/learning-and-resources/xml-resources) names **Trademark Applications Documentation v2.3-20250813** and **Table 1 Trademark Status Codes 20250813** as the current trademark-application contracts.
- [USPTO ODP registration notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal) requires a signed-in USPTO.gov account to search and download ODP datasets beginning June 18, 2026.

The product endpoints returned HTTP 403 with the worktree's retained API key. The current DOC links returned the ODP HTML application shell instead of document bytes. The exact response body and official HTML pages are retained by SHA-256 and verified through the manifest. No browser-session or unattended-login mechanism is inferred.

## Retained artifacts

Full ZIPs stay outside Git under `~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>`. The three retained ZIPs pass archive validation, match their manifest byte sizes and SHA-256 values, and decompress to the exact XML hashes recorded in the manifest.

The files were found in the storage path used by the legacy MerchBase downloader. That implementation queried the two product endpoints, selected `fileTypeText=data`, used each official `fileDownloadURI`, downloaded with `x-api-key`, and stored `<dataset>.zip` under Electron `userData/trademark`. The original per-file download URIs were not retained, so the manifest leaves them null. Parsed database rows are not fixture sources.

| Product | Filename | Proven coverage | Actions | Records |
| --- | --- | --- | --- | ---: |
| `TRTYRAP` | `apc18840407-20241231-02.zip` | Upstream filename label only; official metadata unavailable | `TX` | 155,000 |
| `TRTDXFAP` | `apc240914.zip` | Every observed transaction date is 2024-09-14 | `NA`, `TX` | 11,012 |
| `TRTDXFAP` | `apc240925.zip` | Every observed transaction date is 2024-09-25 | `IB`, `NA`, `TX` | 38,179 |

The XML root is `trademark-applications-daily`, version `2.0`, version date `20041108`. Artifact creation timestamps, transaction-date ranges, ordered action-group occurrences and counts, full XML hashes, and ZIP hashes are verification inputs rather than prose claims.

## Committed evidence

Committed files are exact `<case-file>` byte ranges, including original indentation and line endings. The manifest supplies the enclosing root/version, action-key occurrence, global record index, action-local record index, serial number, and expected presence semantics.

Evidence currently pinned:

- Annual status-only `TX`, including missing mark/owner/classification/goods groups and a present-empty correspondent
- Daily `IB`, `NA`, and `TX`
- Daily `TX` revival from status 602 to 616
- Daily `TX` publication from status 774 to 686 with the source event `PUBLISHED FOR OPPOSITION`
- Present classification-group replacement and goods text preserving brackets, double parentheses, and asterisks
- Registration and cancellation records with source-reported event descriptions

## Blocking gaps

The canonical-ingestion fixture gate remains closed:

- ODP sign-in blocks current product metadata, artifact downloads, and current DOC bytes; the retained API key alone receives HTTP 403.
- Only annual suffix `-02` is retained. Annual part presence, ordering, overlap, complete generation enumeration, the full annual application record, and the full-to-status-only annual pair are unproved.
- Retained daily artifacts contain no numeric Official Gazette action key.
- Registration and cancellation have real single-observation evidence, not retained multi-observation sequences.

These are evidence gaps. Do not derive annual order from suffixes, infer omitted parts, map unknown action keys, or promote event-history text into source-observation ordering.
