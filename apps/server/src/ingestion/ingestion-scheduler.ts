import { PgBoss } from "pg-boss";
import postgres from "postgres";

export const reconcileQueue = "ingestion-reconcile";
const heartbeatSeconds = 60;
const expireInSeconds = 23 * 60 * 60;
export const reconcileQueueOptions = {
  deleteAfterSeconds: 30 * 24 * 60 * 60,
  expireInSeconds,
  heartbeatSeconds,
  policy: "exclusive" as const,
  retryLimit: 0,
};

function scheduleCron(pollMs: number) {
  const seconds = pollMs / 1_000;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60 || 60 % seconds !== 0) {
    throw new Error("USPTO_SCHEDULER_POLL_MS must be a whole-second divisor of 60000");
  }
  return seconds === 60 ? "* * * * *" : `*/${seconds} * * * * *`;
}

export function createIngestionScheduler(options: {
  databaseUrl: string;
  onError?: (error: Error) => void;
  pollMs: number;
  reconcile: () => Promise<unknown>;
}) {
  const boss = new PgBoss({
    application_name: "tmturtle-ingestion-scheduler",
    connectionString: options.databaseUrl,
    migrate: false,
  });
  const listener = postgres(options.databaseUrl, { max: 1, prepare: false });
  let corpusEvents: Awaited<ReturnType<typeof listener.listen>> | null = null;
  let started = false;
  let firstReconciliationSettled = false;
  let resolveFirstReconciliation!: (outcome: { ok: boolean }) => void;
  const firstReconciliation = new Promise<{ ok: boolean }>((resolve) => {
    resolveFirstReconciliation = resolve;
  });

  boss.on("error", (error) => (options.onError ?? console.error)(error));

  return {
    async start() {
      if (started) return;
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
      await boss.schedule(reconcileQueue, scheduleCron(options.pollMs), {}, reconcileQueueOptions);
      corpusEvents = await listener.listen("corpus_events", () => {
        void boss.send(reconcileQueue, { reason: "corpus-event" }).catch((error: unknown) => {
          (options.onError ?? console.error)(error instanceof Error ? error : new Error(String(error)));
        });
      });
      await boss.send(reconcileQueue, { reason: "process-start" });
      started = true;
    },
    waitForFirstReconciliation() {
      return firstReconciliation;
    },
    async stop() {
      if (!started) return;
      await corpusEvents?.unlisten();
      corpusEvents = null;
      await listener.end({ timeout: 1 });
      await boss.stop({ close: true, graceful: true, timeout: 30_000 });
      started = false;
    },
  };
}
