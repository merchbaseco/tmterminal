---
summary: Sets the Trademark Terminal documentation contract, final information architecture, frontmatter quality, brevity, review, and retirement rules.
read_when:
  - adding, moving, reviewing, or retiring Markdown files under docs
  - deciding whether a claim belongs in product, internals, reference, operations, design, or decisions
  - correcting docs that are stale, repetitive, too detailed, or difficult for agents to route
---

# Docs Policy

Trademark Terminal docs exist for knowledge that is hard to recover from code
search: product contracts, ownership boundaries, source precedence, external
formats, operational workflows, and accepted tradeoffs.

Do not document what a well-named type, function, test, or package script already
tells a reader.

## Surfaces

| Section | Purpose | Excludes |
| --- | --- | --- |
| `product/` | User-facing behavior and intentional omissions. | Source tours, SQL, migration history. |
| `internals/` | Ownership, data flow, boundaries, and invariants. | Marketing copy, line-by-line inventories. |
| `reference/` | Exact names, states, schemas, APIs, precedence, and external rules. | Broad rationale and task plans. |
| `operations/` | Commands, verification, deployment, recovery, and issue workflow. | Product specs and architecture essays. |
| `design/` | Visual language and component ownership. | Feature behavior and custom component forks. |
| `decisions/` | Accepted tradeoffs and their consequences. | Implementation diaries and temporary plans. |

Split a page that crosses surfaces. Link to the owner instead of copying its
contract.

## Frontmatter

Every Markdown file under `docs/` starts with:

```yaml
---
summary: One specific sentence naming what this page owns.
read_when:
  - a concrete change or diagnostic trigger using Trademark Terminal nouns
---
```

Use varied, task-specific hints. Avoid “working on the API” or repeated generic
phrasing. Run `bun run docs:list` at task start and after documentation changes.

## Writing Rules

- State contracts directly and in present tense.
- Name product nouns from root `CONTEXT.md`; do not invent synonyms.
- Use tables for ownership, states, precedence, and command maps.
- Use bullets for invariants and intentional omissions.
- Keep implementation status separate from target behavior.
- Preserve exact commands and external limits only in reference or operations.
- Link to official external contracts instead of copying long explanations.
- Cut filler, repeated motivation, source-file tours, test inventories, and task history.
- Remove superseded names rather than documenting compatibility aliases.

## Substantive Changes

For a documentation rewrite or architecture change:

1. Inventory the old page and relevant source.
2. Assign every durable claim to one final surface or discard it as stale plan.
3. Draft from evidence, not memory.
4. Tighten for brevity and remove overlap.
5. Run one independent review for stale claims, missing context, contradictions,
   and excess prose.
6. Resolve findings, then validate routes, links, frontmatter, and stale names.

Do not delete an old page until its useful content has been migrated,
intentionally discarded, or recorded as a superseded decision.

## Completion Contract

The final tree is the only documentation source of truth. Completion requires:

- no old `plan.md`, `specs/`, `adr/`, or `agents/` hierarchy remains;
- every surviving page has specific frontmatter;
- every local Markdown link resolves;
- `bun run docs:list` routes the final surfaces cleanly;
- stale corpus, frontier, annual-mode, daily-mode, and automatic-retry contracts
  do not survive outside explicit historical context;
- an independent review has checked the substantive pages.

This is a rewrite, not a compatibility layer over the old docs.
