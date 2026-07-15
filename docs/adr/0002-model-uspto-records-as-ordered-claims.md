---
summary: Records the decision to project USPTO records as presence-aware ordered claims over immutable source observations.
read_when:
  - changing parser presence semantics, source precedence, canonical projection, replay, or provenance
  - deciding how annual and daily USPTO records replace or preserve canonical field groups
---

# Model USPTO records as ordered claims

Trademark Turtle stores immutable USPTO artifact versions and lossless source observations, then materializes each mark by folding presence-aware typed claims in source-authority order. It does not treat a `case-file` as an unconditional snapshot and does not use `status_date` as whole-record precedence: retained annual `TX` records contain lifecycle fields while omitting mark text, filing facts, owners, classes, and goods, and retained daily records correct those groups without changing `status_date`. Official annual metadata dates establish generation membership only; retained annual XML contains later transaction dates, so metadata dates, filename suffixes, and product-response position never order claims. Scalar absence therefore preserves prior knowledge, present complete collections replace their domain group, and unproven source shapes or precedence remain unresolved rather than mutating canonical state. Raw ZIPs, observation provenance, and versioned parser/projection policies make every canonical group replayable and auditable.
