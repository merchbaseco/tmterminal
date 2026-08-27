---
summary: Leftover maintainer notes that are not inferable from code or the public site.
read_when:
  - looking for operator, ingestion, environment, or decision notes
---

# Maintainer notes

Seller help is [tmterminal.merchbase.co/help](https://tmterminal.merchbase.co/help).
CLI and HTTP contracts live in the published package READMEs. Shared nouns live
in root [`GLOSSARY.md`](../GLOSSARY.md). `CONTEXT.md` is a symlink to that file.

These pages stay because they are hard to recover from code search.

| Topic | Doc |
| --- | --- |
| USPTO discovery, download, apply, restart | [Ingestion](internals/ingestion.md) |
| Clerk credentials and Access Projections | [Access boundary](internals/access-boundary.md) |
| Tables, source states, mark precedence | [Data model](reference/data-model.md) |
| ODP quotas, XML identity, class semantics | [USPTO source](reference/uspto-source.md) |
| Verification lanes | [Testing](operations/testing.md) |
| Mac mini release | [Deployment](operations/deployment.md) |
| Linear routing and triage labels | [Issues](operations/issues.md) |
| Quiet Utility / COSS | [Design](design/system.md) |
| Live data is immediately queryable | [Live trademark knowledge](decisions/live-trademark-knowledge.md) |
| Thin authenticated website | [Thin website](decisions/thin-website-v1.md) |
| Mac mini hosting | [Mac mini hosting](decisions/mac-mini-v1-hosting.md) |
