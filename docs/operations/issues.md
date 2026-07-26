---
summary: Defines how Trademark Terminal work is created and triaged in the shared Products Linear team.
read_when:
  - creating, reading, updating, or triaging Trademark Terminal issues in Linear
  - changing team routing, the product label, intake state, or triage labels
---

# Issues

Trademark Terminal work lives in the shared Linear Products team.

## Routing

- Team: `Products`
- Key: `PRD`
- Product label: `Trademark Terminal`
- Intake state: `Triage`
- Identifier shape: `PRD-<number>`

Do not create a separate team or assume a Linear project.

## Create

Use the authenticated `linear` CLI:

```bash
linear issue create \
  --team PRD \
  --state Triage \
  --label "Trademark Terminal" \
  --label agent-filed \
  --label needs-triage \
  --title "Short factual title" \
  --description-file /tmp/linear-issue.md \
  --no-interactive
```

Add one workspace type such as `Bug`, `Feature`, or `Improvement` when useful.
Always pass `--state Triage`; otherwise Linear uses the team's normal default.

## Triage Labels

| Role | Label |
| --- | --- |
| Maintainer evaluation needed | `needs-triage` |
| Waiting for reporter | `needs-info` |
| Fully specified for an agent | `ready-for-agent` |
| Requires human implementation | `ready-for-human` |
| Will not be actioned | `wontfix` |

Use `linear issue list --team PRD` for the queue and
`linear issue view PRD-<number>` for full context.
