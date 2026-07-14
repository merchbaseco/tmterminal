import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalArtifactStore } from "../../src/ingestion/local-artifact-store.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("streams one immutable content-addressed object for unchanged bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);

  const first = await store.put(new Blob(["alpha"]).stream(), 5);
  const second = await store.put(new Blob(["alpha"]).stream(), 5);

  expect(first).toEqual({
    bytes: 5,
    objectKey: "sha256/8e/8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
    sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
  });
  expect(second).toEqual(first);
  expect(await store.head(first.objectKey)).toEqual({ bytes: 5 });
  expect(await new Response(await store.get(first.objectKey)).text()).toBe("alpha");
  expect(await readdir(join(root, "sha256", "8e"))).toEqual([first.sha256]);
});

test("rejects an incomplete stream without retaining it", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);

  await expect(store.put(new Blob(["short"]).stream(), 10)).rejects.toThrow("expected 10 bytes, received 5");
  expect(await readdir(root)).toEqual([]);
});

test("cancels an oversized stream before retaining its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-artifacts-"));
  roots.push(root);
  let cancelled = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
    start(streamController) {
      controller = streamController;
      streamController.enqueue(new TextEncoder().encode("oversized"));
    },
  });

  const outcome = createLocalArtifactStore(root).put(body, 5).catch((error: unknown) => error);
  await Bun.sleep(10);
  const entriesBeforeSourceCompletion = await readdir(root);
  if (!cancelled) controller.close();

  expect(await outcome).toHaveProperty("message", "Artifact expected 5 bytes, received 9");
  expect(cancelled).toBe(true);
  expect(entriesBeforeSourceCompletion).toEqual([]);
  expect(await readdir(root)).toEqual([]);
});

test("removes stale staging bytes without touching a recent writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-artifacts-"));
  roots.push(root);
  const stale = join(root, ".put-stale");
  const recent = join(root, ".put-recent");
  await Bun.write(stale, "orphaned");
  await Bun.write(recent, "active");
  await utimes(stale, new Date(0), new Date(0));
  const store = createLocalArtifactStore(root, { now: () => 10_000, stagingMaxAgeMs: 5_000 });

  await store.put(new Blob(["alpha"]).stream(), 5);

  expect((await readdir(root)).sort()).toEqual([".put-recent", "sha256"]);
});
