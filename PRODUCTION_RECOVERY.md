# Production Worker Recovery

## Current State (2026-10-02)

Production worker is unhealthy with stale data:
- Latest processed date: 2026-08-27
- Last activity: 2026-08-28T19:12:07.780Z
- Worker log: `SourceHttpError: USPTO ODP request failed with HTTP 429, phase catalog`
- Root cause: Persisted discovery error in `worker_status.current_error` blocks all reconcile attempts

## Safe Recovery Steps

### 1. Verify Current State

Connect to production database and check worker status:

```sql
SELECT 
  current_error,
  last_discovery_at,
  last_heartbeat_at,
  activity
FROM worker_status 
WHERE id = 'uspto';
```

Expected: `current_error` contains "USPTO ODP request failed with HTTP 429"

### 2. Clear Persisted Error

The fix (PR #57) now distinguishes transient errors (429, 503) from permanent failures and stores them with "Discovery backoff until" prefix. However, the existing persisted error predates this fix and will continue blocking reconcile.

After PR #57 is deployed, clear the stale 429 error manually:

```sql
UPDATE worker_status 
SET current_error = NULL,
    updated_at = NOW()
WHERE id = 'uspto'
  AND current_error LIKE '%USPTO ODP request failed with HTTP 429%';
```

**Important**: Do not clear errors with "Discovery backoff until" prefix, as these represent active backoff periods that respect provider timing.

### 3. Verify Recovery

Check data freshness and worker status:
```sql
SELECT 
  latest_processed_date,
  last_successful_update_at,
  worker_current_error,
  worker_last_discovery_at
FROM (
  SELECT 
    max(source_to_date)::text as latest_processed_date,
    (SELECT last_successful_update_at FROM data_state WHERE id = 'uspto') as last_successful_update_at,
    (SELECT current_error FROM worker_status WHERE id = 'uspto') as worker_current_error,
    (SELECT last_discovery_at FROM worker_status WHERE id = 'uspto') as worker_last_discovery_at
  FROM source_artifact 
  WHERE applied_record_count > 0
) status;
```

Expected:
- `latest_processed_date` advances beyond 2026-08-27
- `worker_current_error` is NULL or contains valid backoff prefix
- `worker_last_discovery_at` advances after deployment

### 4. Future Prevention

After this fix:
- Transient failures (429, 503) will respect backoff and auto-retry
- Permanent failures (404, 400, contract errors) will still stop the worker
- Backoff errors are visible in `current_error` with "Discovery backoff: " prefix
- Manual intervention only needed for genuine system failures

## Timing

- Deploy PR #57 during normal maintenance window
- Run recovery SQL immediately after deployment
- Monitor for 10-15 minutes to confirm discovery resumes
- Data catch-up will take several hours depending on backlog
