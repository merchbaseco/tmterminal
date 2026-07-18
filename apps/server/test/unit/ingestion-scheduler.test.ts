import { afterEach, expect, mock, spyOn, test } from "bun:test";

import { createIngestionScheduler } from "../../src/ingestion/ingestion-scheduler.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function fakeTimers() {
  const scheduled: Array<{ callback: () => void; delay: number; timer: Timer }> = [];
  const cleared: Timer[] = [];
  let nextTimer = 0;
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
    nextTimer += 1;
    const timer = nextTimer as unknown as Timer;
    scheduled.push({ callback, delay: delay ?? 0, timer });
    return timer;
  }) as typeof setTimeout);
  spyOn(globalThis, "clearTimeout").mockImplementation(((timer: Timer) => {
    cleared.push(timer);
  }) as typeof clearTimeout);
  return { cleared, scheduled };
}

afterEach(() => mock.restore());

test("reconciles immediately without overlap and waits ten seconds after completion", async () => {
  const timers = fakeTimers();
  const first = deferred();
  const second = deferred();
  const work = [first, second];
  let calls = 0;
  const scheduler = createIngestionScheduler({
    reconcile: async () => {
      const call = calls;
      calls += 1;
      await work[call]?.promise;
    },
  });

  await scheduler.start();
  await flushPromises();
  expect(calls).toBe(1);
  expect(timers.scheduled).toHaveLength(0);

  first.resolve();
  expect(await scheduler.waitForFirstReconciliation()).toEqual({ ok: true });
  await flushPromises();
  expect(timers.scheduled.map(({ delay }) => delay)).toEqual([10_000]);

  timers.scheduled.shift()?.callback();
  await flushPromises();
  expect(calls).toBe(2);
  expect(timers.scheduled).toHaveLength(0);

  second.resolve();
  await flushPromises();
  expect(timers.scheduled.map(({ delay }) => delay)).toEqual([10_000]);

  const [pending] = timers.scheduled;
  if (!pending) {
    throw new Error("next reconciliation was not scheduled");
  }
  await scheduler.stop();
  expect(timers.cleared).toEqual([pending.timer]);
});

test("stop waits for an active reconciliation and does not schedule another", async () => {
  const timers = fakeTimers();
  const work = deferred();
  let stopSettled = false;
  const scheduler = createIngestionScheduler({ reconcile: () => work.promise });

  await scheduler.start();
  await flushPromises();
  const stopping = scheduler.stop().then(() => {
    stopSettled = true;
  });
  await flushPromises();
  expect(stopSettled).toBe(false);

  work.resolve();
  await stopping;
  expect(timers.scheduled).toHaveLength(0);
});

test("reports first-reconciliation failure and continues the fixed-delay loop", async () => {
  const timers = fakeTimers();
  const failure = new Error("reconciliation failed");
  const errors: Error[] = [];
  const scheduler = createIngestionScheduler({
    onError: (error) => errors.push(error),
    reconcile: () => Promise.reject(failure),
  });

  await scheduler.start();
  expect(await scheduler.waitForFirstReconciliation()).toEqual({ ok: false });
  await flushPromises();
  expect(errors).toEqual([failure]);
  expect(timers.scheduled.map(({ delay }) => delay)).toEqual([10_000]);
  await scheduler.stop();
});
