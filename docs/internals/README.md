---
summary: Routes Trademark Terminal internals for workspace ownership, service boundaries, persistence, and source ingestion.
read_when:
  - locating the owner of server, website, client, CLI, authentication, database, or worker behavior
  - checking system boundaries before changing ingestion or query architecture
---

# Internals

Internals docs explain where behavior lives and which boundaries must survive
refactoring.

| System | Doc |
| --- | --- |
| Workspace, applications, clients, auth, and persistence | [Architecture](architecture.md) |
| Source discovery, download, validation, application, cleanup, and restart | [Ingestion](ingestion.md) |
