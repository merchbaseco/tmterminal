---
summary: Routes Trademark Turtle documentation for product scope, ingestion, clients, website behavior, decisions, and engineering workflows.
read_when:
  - choosing which Trademark Turtle contracts to read before changing behavior
  - adding, moving, renaming, or retiring documentation
---

# Trademark Turtle docs

Trademark Turtle owns USPTO trademark discovery, ingestion, normalization, persistence, freshness, and authenticated search for print-on-demand sellers. These docs define the product and engineering contracts that are difficult to recover from code alone.

## Start here

| Task | Read |
| --- | --- |
| Understand product scope or system ownership | [Implementation plan](plan.md) |
| Change USPTO ingestion, projection, replay, or freshness | [USPTO ingestion](ingestion.md), [ordered-claims decision](adr/0002-model-uspto-records-as-ordered-claims.md) |
| Change deployment, backups, artifact storage, or hosting | [Implementation plan](plan.md), [Mac mini hosting decision](adr/0003-host-v1-on-mac-mini.md) |
| Change HTTP procedures or automation behavior | [Implementation plan](plan.md), [CLI](cli.md) |
| Change CLI commands, output, or errors | [CLI](cli.md) |
| Change the authenticated web product or visual system | [Website](website.md), [website decision](adr/0001-include-thin-website-in-v1.md) |
| Change domain terminology or architecture decisions | [Domain docs](agents/domain.md), root `CONTEXT.md`, relevant ADRs |
| Create or triage implementation work | [Issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md) |
| Add or reorganize documentation | [Docs policy](docs-policy.md) |

Keep the structure small while the product is small. Add feature, API, architecture, or operations sections when multiple durable pages need those distinctions; do not create empty hierarchy in advance.
