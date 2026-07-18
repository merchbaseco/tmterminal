---
summary: Defines the authenticated v1 website's routes, search behavior, reports, mark detail, API-key management, and visual system.
read_when:
  - changing website routes, authentication flow, search interactions, result presentation, reports, mark detail, API keys, or freshness UI
  - changing the COSS UI composition, typography, appearance themes, primary color, or responsive behavior
---

# Trademark Turtle website

The v1 website is a thin authenticated client for trademark search, reports, mark detail, API-key management, and data freshness. It is not a marketing site or a general-purpose dashboard.

## Product surface

- Shared MerchBase Clerk sign-in
- Search and inline results
- Stable mark-detail routes
- Parameterized reports
- API-key creation and revocation
- Data freshness popover

Signed-out visitors see the search composition. Submitting starts Clerk sign-in, preserves the query, and executes it after authentication. No data route is anonymous.

## Routes

```text
/                                      search
/search?...                            shareable search state
/marks/:serial-number                 mark detail
/reports?...                           generated report
/settings/api-keys                     API-key management
```

The top navigation contains Search, a Reports preset menu, API Keys, the data-through date, appearance, and the Clerk user menu. There is no sidebar.

## Visual system

- Stock COSS UI components and variants; do not fork or restyle component internals
- Tailwind CSS 4 token configuration only
- Archivo Variable as the sole typeface
- Mastheads and result names use heavy condensed Archivo
- Shared primary color `#D7F52A` in light and dark themes
- The turtle logomark is chartreuse on near-black. Dark themes may use the transparent mark directly; light themes use its protected near-black field rather than an inverted logo.
- Light, dark, and system appearance; follow system initially and persist user choice
- Flat neutral backgrounds, thin rules, and large typography
- The turtle is a brand mark, not a UI mascot. No mascot illustrations, grain, cards, gradients, glass, shadows, or decorative empty states.

The composition borrows Cassette's oversized typographic scale and sparse utilitarian rhythm without copying its identity or imagery.

## Search

The masthead reads `TRADEMARK TURTLE` across the viewport. One large single-query field and explicit Search action dominate the page.

Query or mode edits wait for Search or Enter. Filter and sort changes refetch immediately. Editing does not replace current results until the next search succeeds.

Modes:

- Multi: exact and partial toggles, both enabled by default
- Split: exact matches for every adjacent Unicode word-token combination; punctuation separates words
- Wildcard: `*` represents zero or more characters across the whole mark; patterns containing `*`
  require at least three consecutive literal Unicode word characters, while `%`, `_`, and `\` remain
  literal

Multi is the default mode. Wildcard validation happens before the request.

Stored data and every programmatic interface are fixed to International Class 025 in v1, so the website does not show or send a class filter. Status filters use the canonical whole-mark disposition. International Classes remain visible source facts on result and detail views.

Visible filters mirror TMhunt:

- Status: All, Live, Dead
- Type: All, Design, Typeset, Text
- Registered: All, Yes, No
- Preset: Set to Live & Text

Sorts:

- Relevance: exact matches first, then partial matches by relevance
- Newest activity: descending USPTO source transaction date across all matches
- Oldest activity: ascending USPTO source transaction date across all matches

## Search URLs

Search URLs encode the query, mode, exact/partial selection, filters, and sort. Infinite-scroll depth is not part of the URL.

```text
/search?q=good+vibes&mode=multi&exact=true&partial=true&status=all&type=all&registered=all&sort=relevance
```

## Results

Results render directly below search controls as full-width typographic rows, not a card or table container. Each row includes:

- Word mark
- Exact or partial match kind
- Live/dead status
- International Classes
- Owner
- One-line goods/services excerpt
- Serial and registration numbers
- Status date

Use one ranked list. TanStack Query `useInfiniteQuery` owns 25-item offset pages; TanStack Virtual renders the growing list. Do not use TanStack Table for the editorial row layout. Preserve loaded pages and scroll position when returning from mark detail.

## Mark detail

`/marks/:serial-number` is a stable, shareable route. It is one scrolling document with no tabs or cards:

- Back to results
- Word mark and status
- Identity numbers and dates
- Owner
- International Classes and goods/services
- Status history
- USPTO source and provenance

Status history contains distinct source-reported status transitions. Repeated observations are provenance, not duplicate user-visible events.

## Reports

Reports are generated result views, not bespoke pages. `/reports` accepts typed, allowlisted parameters and reuses the result list.

Preset navigation links:

```text
/reports?event=filed&window=previous-week
/reports?event=registered&window=previous-week
/reports?event=published-for-opposition
```

Previous week means Monday through Sunday. Filed and registered reports use their dedicated USPTO dates. Published for Opposition means marks whose current versioned USPTO status is Published for Opposition; it does not claim that a legally extended opposition window remains open. A report's defining constraint is fixed; Status, Type, Registered, and sort remain adjustable.

## API keys and freshness

The API Keys page lists name, suffix, creation time, last-used time, and status. Creation asks only for a name, shows the raw `ttk_...` token exactly once, and requires explicit acknowledgement that it was saved. Revocation lives in the row menu.

The top bar shows `Corpus syncing` before searchable coverage exists and the contiguous corpus-through date afterward. Its COSS popover shows plain-language synchronization status, searchable coverage, the last successful update, and staleness. It reads once on mount, rereads when opened, and does not poll. Queue position, failed-artifact details, and provider diagnostics remain operator-only.

Operators with the server-enforced database role also receive a top-bar link to `/ops/sync`. That read-only route presents corpus synchronization as a continuous system: processed marks and source records, corpus coverage, last activity, current health, and USPTO connectivity. An always-visible source-ordered file table carries state, counts, coverage, timestamps, and errors with bounded stable pagination. A compact system-details table carries corpus, provider, and subordinate identifier facts. The route has no mutation controls, queue-progress framing, drawers, or access for ordinary authenticated customers and API keys.

## States and responsiveness

- Initial results: three typographic skeleton rows
- Loading more: one inline spinner row
- Empty: `No matching marks` and Clear filters
- Validation: inline beneath the search field
- Data-version conflict: explicit alert and Run search again action; never reset or mix pages silently
- Service unavailable: full-width alert; never present stale results as current

Desktop composition is primary. Mobile keeps the same information architecture: fluid masthead, stacked search action, compact filter drawer, wrapped result metadata, and unchanged top-level routes.

Every search, report, and detail page ends with:

> Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.
