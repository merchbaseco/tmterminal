import { PgBoss } from "pg-boss";

export const reconcileQueue = "ingestion-reconcile";
const heartbeatSeconds = 60;
const expireInSeconds = 23 * 60 * 60;
const reconciliationCron = "*/10 * * * * *";
export const reconcileQueueOptions = {
  deleteAfterSeconds: 30 * 24 * 60 * 60,
  expireInSeconds,
  heartbeatSeconds,
  policy: "exclusive" as const,
  retryLimit: 0,
};

export function createIngestionScheduler(options: {
  databaseUrl: string;
  onError?: (error: Error) => void;
  reconcile: () => Promise<unknown>;
}) {
  const boss = new PgBoss({
    application_name: "tmturtle-ingestion-scheduler",
    connectionString: options.databaseUrl,
    migrate: false,
  });
  let started = false;
  let firstReconciliationSettled = false;
  let resolveFirstReconciliation!: (outcome: { ok: boolean }) => void;
  const firstReconciliation = new Promise<{ ok: boolean }>((resolve) => {
    resolveFirstReconciliation = resolve;
  });

  boss.on("error", (error) => (options.onError ?? console.error)(error));

  return {
    async start() {
      if (started) {
        return;
      }
      await boss.start();
      await boss.createQueue(reconcileQueue, reconcileQueueOptions);
      await boss.work(reconcileQueue, { pollingIntervalSeconds: 1 }, async () => {
        try {
          const result = await options.reconcile();
          if (!firstReconciliationSettled) {
            firstReconciliationSettled = true;
            resolveFirstReconciliation({ ok: true });
          }
          return result;
        } catch (error) {
          if (!firstReconciliationSettled) {
            firstReconciliationSettled = true;
            resolveFirstReconciliation({ ok: false });
          }
          throw error;
        }
      });
      await boss.schedule(reconcileQueue, reconciliationCron, {}, reconcileQueueOptions);
      await boss.send(reconcileQueue, { reason: "process-start" });
      started = true;
    },
    async stop() {
      if (!started) {
        return;
      }
      await boss.stop({ close: true, graceful: true, timeout: 30_000 });
      started = false;
    },
    waitForFirstReconciliation() {
      return firstReconciliation;
    },
  };
}
