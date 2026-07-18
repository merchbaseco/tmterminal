const reconciliationDelayMs = 10_000;

export function createIngestionScheduler(options: {
  onError?: (error: Error) => void;
  reconcile: () => Promise<unknown>;
}) {
  let activeReconciliation: Promise<void> | undefined;
  let nextTimer: Timer | undefined;
  let started = false;
  let resolveFirstReconciliation!: (outcome: { ok: boolean }) => void;
  const firstReconciliation = new Promise<{ ok: boolean }>((resolve) => {
    resolveFirstReconciliation = resolve;
  });

  function reconcile() {
    if (!started || activeReconciliation) {
      return;
    }
    const current = (async () => {
      try {
        await options.reconcile();
        resolveFirstReconciliation({ ok: true });
      } catch (error) {
        resolveFirstReconciliation({ ok: false });
        (options.onError ?? console.error)(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    })();
    activeReconciliation = current;
    current.finally(() => {
      activeReconciliation = undefined;
      if (started) {
        nextTimer = setTimeout(() => {
          nextTimer = undefined;
          reconcile();
        }, reconciliationDelayMs);
      }
    });
  }

  return {
    start() {
      if (started) {
        return;
      }
      started = true;
      reconcile();
    },
    async stop() {
      started = false;
      if (nextTimer) {
        clearTimeout(nextTimer);
        nextTimer = undefined;
      }
      await activeReconciliation;
    },
    waitForFirstReconciliation() {
      return firstReconciliation;
    },
  };
}
