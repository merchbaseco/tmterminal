---
summary: Records the decision to host v1 on the Mac mini and the workload and operating signals that justify a future managed move.
read_when:
  - changing production topology, database hosting, artifact storage, worker placement, or availability targets
  - evaluating whether capacity or reliability warrants managed compute and PostgreSQL
---

# Host V1 On The Mac Mini

Status: Accepted

Date: 2026-07-14

## Context

The workload is PostgreSQL, a small authenticated API and website, and one
serial ingestion worker streaming one large ZIP at a time. The existing Mac mini
and Docker Compose can run that shape without introducing a premature cloud
stack.

## Decision

V1 runs PostgreSQL, migration, API, worker, and Caddy on the Mac mini behind
Cloudflare Tunnel. PostgreSQL and temporary artifact storage use named volumes.
One-file processing, resource limits, disk floors, restart policies, and
exact-SHA deployment bound the host risk.

If the service moves, API and worker compute move into the same region as
PostgreSQL. Do not put only the database across the home WAN.

## Consequences

- The supported release path is the self-hosted GitHub runner and production
  Compose project.
- Source objects use artifact-scoped keys, never absolute host paths.
- Raw source files are working data, not backups.
- An automated backup product is deferred; deployment docs must not claim one
  exists.
- The Mac mini remains appropriate until outages, recovery needs, sustained
  query latency, resource pressure, multiple-host requirements, or operator
  burden justify managed hosting.
- The first managed target is colocated long-running web and worker compute plus
  PostgreSQL with `pg_trgm`, not duration-limited edge functions.
