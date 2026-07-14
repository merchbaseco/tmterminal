---
summary: Defines Trademark Turtle's docs surfaces, routed frontmatter, contract language, and maintenance expectations.
read_when:
  - adding, moving, renaming, reviewing, or retiring Markdown files under docs
  - deciding whether information belongs in a product contract, ADR, engineering workflow, or source code
---

# Docs policy

Trademark Turtle docs preserve product behavior, service ownership, external-data semantics, exact client contracts, operational workflows, and accepted architecture decisions that are difficult to recover from code search.

Do not document facts already obvious from a well-named file, type, test, or package script.

## Current surfaces

- `plan.md` owns the durable product and architecture contract plus implementation sequence.
- `ingestion.md`, `cli.md`, and `website.md` own focused product and engineering contracts.
- `adr/` records accepted architectural decisions and their consequences.
- `agents/` configures shared engineering workflows for this repository.
- `README.md` routes readers; it does not duplicate the underlying contracts.

Add `features/`, `api/`, `architecture/`, `operations/`, or `specs/` only when the implemented product has enough durable material to justify the boundary. Prefer moving an existing contract into the new surface over maintaining duplicate pages.

## Routed frontmatter

Every Markdown file under `docs/` starts with:

```yaml
---
summary: One specific sentence naming what the page owns.
read_when:
  - a concrete change or diagnostic trigger using Trademark Turtle nouns
---
```

`summary` describes the durable subject. `read_when` routes an agent to the page before relevant work; avoid generic hints such as “working on the API.”

Run `bun run docs:list` at task start and after documentation changes. Every listed page should render a summary and useful `Read when` hints without metadata errors.

## Contract language

- State current product behavior directly and in present tense.
- Keep product scope and intentional omissions explicit.
- Separate user-visible behavior, architecture ownership, exact interface contracts, operations, and decisions when they become distinct bodies of knowledge.
- Record accepted tradeoffs in ADRs, not as research diaries inside product docs.
- Remove stale names and superseded behavior rather than preserving compatibility prose.

## As implementation lands

Update the page that owns changed behavior in the same reviewable change. Add a new page only when the new capability, exact contract, architecture boundary, or operational workflow needs a durable home. Keep links and routing metadata current when pages move.
