---
summary: Pins the official USPTO products, access and download limits, XML identity, classification semantics, status policy, and fixture evidence.
read_when:
  - changing ODP discovery, download requests, redirect handling, XML parsing, classification selection, or status mapping
  - updating byte-exact USPTO fixtures or auditing source behavior against official documentation
---

# USPTO Source

Trademark Turtle consumes full-text trademark application XML without images
from the USPTO Open Data Portal.

## Products

| Product | Provider frequency | Role |
| --- | --- | --- |
| `TRTYRAP` | `YEARLY` | Broad historical application files. |
| `TRTDXFAP` | `DAILY` | Narrow application update files. |

Frequency describes provider packaging only. Both products enter one source
ledger, chronological queue, parser, and application path.

Product discovery uses:

```text
GET https://api.uspto.gov/api/v1/datasets/products/<product>
accept: application/json
x-api-key: <secret>
```

## Access And Limits

The [USPTO Bulk Datasets Downloads API](https://data.uspto.gov/apis/getting-started)
states:

- the same non-XML file may be downloaded at most 20 times per year per API
  key; XML files have a higher limit;
- one IP may download at most five files per 10 seconds;
- signed download redirects expire after five seconds.

Trademark Turtle uses the conservative rule needed for ZIP inputs: request a
specific file once, persist the request count before sending it, and never
automatically repeat a failed download. Parsing and application retries reuse
retained bytes and do not contact USPTO.

The API key goes only to `api.uspto.gov`. The exact accepted redirect targets
the USPTO data host, starts immediately, and receives no key. Product and
filename—not the expiring URL—are the durable locator.

ODP dataset search and download require a signed-in USPTO.gov account. See the
[USPTO access notice](https://www.uspto.gov/subscription-center/2026/register-access-usptos-open-data-portal).

## XML Identity

Accepted application documents require:

- root `trademark-applications-daily`;
- exactly one `version-no` equal to `2.0`;
- exactly one `version-date` equal to `20041108`;
- application file segment `TRMK`;
- well-formed `case-file` records with an eight-digit serial identity.

Action keys group transport records and preserve file order. They do not define
trademark product meaning.

The official [XML resources page](https://www.uspto.gov/learning-and-resources/xml-resources)
links the current Trademark Applications Documentation and status-code table.
The retained v2 application documentation defines the XML shapes used by the
source files.

## Classification

Status: Accepted target selection semantics. The deployed parser still uses its
older primary-code-only Class 025 rule until the ingestion migration lands.

International Class evidence comes from explicit `international-code` values.
`primary-code` may stand in only when the filing date is on or after 1973-09-01.
The official application documentation says primary class is international for
applications filed from that date, and the [USPTO Nice Classification guidance](https://www.uspto.gov/trademarks/trademark-updates-and-announcements/nice-agreement-current-edition-version-general-remarks)
confirms that the international system became controlling then. Earlier primary
codes belong to the prior United States classification system.

V1 Tracked Classes is the private constant `['025']`. Missing filing date cannot
authorize the primary-code shortcut.

## Dates And Status

- Source transaction date controls snapshot recency.
- Coverage dates describe files; they are not record recency.
- Missing, zero, or wrong-width optional dates normalize to null.
- Exactly eight-digit non-calendar dates are invalid.
- Nonzero registration numbers normalize to seven digits.

The versioned status policy uses the official status-code table. Known codes map
to Live, Dead, or Indifferent; Indifferent, missing, and future unknown values
remain `unknown` rather than being guessed.

USPTO search includes active and inactive records. Trademark Turtle therefore
keeps legitimate tracked marks when their status becomes abandoned, cancelled,
expired, or otherwise inactive.

## Fixture Evidence

[`fixtures/uspto/manifest.json`](../../fixtures/uspto/manifest.json) owns
machine-readable ZIP, XML, source-coordinate, and record evidence. Full ZIPs
remain outside Git under:

```text
~/Library/Caches/tmturtle/uspto/sha256/<zip-sha256>/<filename>
```

`bun run fixtures:verify` checks retained artifact bytes, exact record ranges,
document identity, and manifest expectations. Parsed database rows are never
fixture sources.

Byte-exact fixtures preserve source/action/index context for:

- selected and unselected annual records;
- pre- and post-1973 classification semantics;
- sparse and complete update records;
- repeated classifications and status events;
- malformed optional values and structural failures;
- older and newer snapshots of the same serial.
