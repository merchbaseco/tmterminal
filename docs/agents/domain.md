---
summary: Routes engineering skills through Trademark Turtle's shared domain model, durable contracts, and architecture decisions.
read_when:
  - using domain-modeling, architecture, planning, or issue-writing skills in this repository
  - adding domain terminology, context documents, ADRs, or package-specific guidance
---

# Domain Docs

How the engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `docs/plan.md` — the durable product and architecture contract.
- `docs/ingestion.md` — annual source, direct projection, generation visibility, and freshness.
- `docs/cli.md` — published command and automation contract.
- `docs/website.md` — website behavior and visual contract.
- `CONTEXT.md` at the repository root, when present.
- Relevant ADRs under `docs/adr/`, when present.

If `CONTEXT.md` or `docs/adr/` does not exist, proceed silently. The domain-modeling workflow creates them lazily when terminology or architectural decisions are resolved.

## File structure

Trademark Turtle uses a single domain context across its Bun workspace:

```text
/
├── CONTEXT.md
├── docs/
│   ├── plan.md
│   ├── ingestion.md
│   ├── cli.md
│   ├── website.md
│   └── adr/
├── apps/
│   ├── server/
│   └── web/
└── packages/
    ├── http-client/
    └── cli/
```

`CONTEXT.md` owns the shared glossary and domain model. `docs/adr/` owns durable architectural decisions. Packages do not maintain separate context documents.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, proposal, hypothesis, or test—use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is missing, reconsider whether the new term is necessary or record the gap for domain modeling.

## Flag contract conflicts

If output contradicts `docs/plan.md` or an existing ADR, surface the conflict explicitly rather than silently overriding it.
