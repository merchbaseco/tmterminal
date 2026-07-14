---
summary: Defines how Trademark Turtle work is routed into the shared Products team in Linear.
read_when:
  - creating, reading, updating, or triaging Trademark Turtle issues in Linear
  - changing the product label, intake state, team routing, or agent-filed issue shape
---

# Issue Tracker

Trademark Turtle issues live in the Knickerbocker Ventures Linear workspace.

## Routing

- Team: `Products`
- Team key: `PRD`
- Product label: `Trademark Turtle`
- Intake state: `Triage`
- Issue identifiers: `PRD-<number>`

Do not create a separate Linear team or assume a Linear project. The product label routes Trademark Turtle work within the shared Products intake queue.

## Creating issues

Use the authenticated `linear` CLI. Agent-filed intake issues use this shape:

```bash
linear issue create \
  --team PRD \
  --state Triage \
  --label "Trademark Turtle" \
  --label agent-filed \
  --label needs-triage \
  --title "Short factual title" \
  --description-file /tmp/linear-issue.md \
  --no-interactive
```

Add one workspace-wide type label such as `Bug`, `Feature`, or `Improvement` when appropriate.

Always pass `--state Triage`; Linear otherwise creates the issue in the team's normal default state.

## Reading and updating issues

Use `linear issue list --team PRD` to inspect the queue and `linear issue view PRD-<number>` for full issue context.

Use the mappings in `docs/agents/triage-labels.md` when changing an issue's triage role.
