---
summary: Records the decision to host v1 on the Mac mini with bounded transient artifact storage and a portable move to managed compute and PostgreSQL.
read_when:
  - changing deployment topology, database hosting, artifact storage, backups, worker placement, or availability targets
  - evaluating whether operational or capacity signals justify moving Trademark Turtle to managed infrastructure
---

# Host v1 on the Mac mini

Trademark Turtle runs on the existing Mac mini through the annual baseline and first real users. Its workload is dominated by PostgreSQL with `pg_trgm`, one continuously running ingestion worker, and one large ZIP/XML working file at a time. The approved Docker Compose topology fits that host directly and avoids a premature multi-service cloud stack.

## v1 boundary

- One Docker host runs the API, worker, one-shot migration, PostgreSQL 16, and Caddy as separate services.
- PostgreSQL and the transient artifact working directory use dedicated volumes. Worker limits prevent bootstrap from starving authenticated queries.
- Database backups leave the Mac mini encrypted; a backup on the same host is not a backup.
- Compact artifact identity/checksums, live projected rows, data state, and source coordinates live in PostgreSQL backups. Terminal raw downloads are deleted.
- Restart-on-boot, external process/freshness monitoring, disk alerts, and a restore drill are release requirements.

## Portability contract

- Runtime configuration uses `DATABASE_URL`, artifact-store configuration, public origin, Clerk settings, and server-secret `USPTO_API_KEY`; code does not discover a particular host.
- Artifact records store content-addressed object keys, never absolute host paths.
- The artifact-store interface supports streaming put/get, finalized-key iteration without byte reads, bounded inspection, and idempotent removal. v1 implements a local-volume adapter for one active object; startup removes unreferenced finalized keys sequentially, while shared content-addressed bytes remain through their final database reference.
- Artifact state, provider lane, and data state remain durable PostgreSQL state; worker timing is process-local. Local disk outside the artifact store is scratch or cache.
- API and worker use direct or session PostgreSQL connections where advisory locks and `LISTEN`/`NOTIFY` require session semantics.
- Container builds remain portable across the Mac mini's architecture and a likely managed Linux target.

Do not move only PostgreSQL off the Mac mini while leaving API and worker compute at home. Ingestion traffic, advisory locks, and notifications would cross the home WAN and add latency plus a new ISP failure boundary. Database and compute move together into one region.

## Migration triggers

Explore managed hosting when one or more of these becomes true:

- two material power, ISP, or host outages occur in one quarter;
- required recovery becomes tighter than the tested home-host path, initially RPO 24 hours or RTO 4 hours;
- authenticated search exceeds 500 ms p95 during ingestion after tuning, sustained host CPU exceeds 70%, memory swaps, or the database disk exceeds 70%;
- the service needs multiple API or worker hosts, managed failover, point-in-time recovery, compliance controls, or additional operators;
- hands-on restart or recovery work becomes a normal monthly task.

Request count alone is not the migration signal. This service is storage- and worker-dominated.

## Managed target

The first managed option is a continuous web service and background worker beside managed PostgreSQL with `pg_trgm` and bounded task scratch space. Render is the simplest current fit; AWS ECS/Fargate and RDS is the higher-control option when its operational surface is justified.

Cloudflare Workers and Vercel Functions may host bounded web work, but they are not the ingestion runtime: worker CPU/duration limits conflict with large streamed downloads, XML parsing, and long artifact jobs.

Provider capabilities must be reverified when migration is proposed; this ADR fixes the workload boundary and migration signals, not a permanent vendor choice.

Current provider references:

- [Render background workers](https://render.com/docs/background-workers) and [PostgreSQL extensions](https://render.com/docs/postgresql-extensions)
- [AWS Fargate task storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
