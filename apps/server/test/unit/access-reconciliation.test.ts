import { describe, expect, test } from "bun:test";
import { ServiceAccessError } from "@merchbaseco/access";

import { createAccessReconciliationScheduler } from "../../src/services/access-reconciliation.ts";

describe("Access Projection reconciliation scheduler", () => {
  test("runs immediately, never overlaps, and waits one interval after completion", async () => {
    let active = 0;
    let maximumActive = 0;
    let release: (() => void) | undefined;
    let runs = 0;
    const scheduler = createAccessReconciliationScheduler({
      delayMs: 5,
      reconcile: async () => {
        runs += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (runs === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        active -= 1;
      },
    });

    scheduler.start();
    scheduler.start();
    await Bun.sleep(10);
    expect(runs).toBe(1);

    release?.();
    await Bun.sleep(12);
    await scheduler.stop();

    expect(runs).toBeGreaterThanOrEqual(2);
    expect(maximumActive).toBe(1);
  });

  test("reports failures and schedules the next repair", async () => {
    const errors: Error[] = [];
    let runs = 0;
    const scheduler = createAccessReconciliationScheduler({
      delayMs: 5,
      onError: (error) => errors.push(error),
      reconcile: () => {
        runs += 1;
        if (runs === 1) {
          return Promise.reject(new ServiceAccessError("access_unavailable"));
        }
        return Promise.resolve();
      },
    });

    scheduler.start();
    await Bun.sleep(12);
    await scheduler.stop();

    expect(errors).toHaveLength(1);
    expect(runs).toBeGreaterThanOrEqual(2);
  });
});
