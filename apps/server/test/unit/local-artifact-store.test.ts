import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalArtifactStore } from "../../src/ingestion/local-artifact-store.ts";

const roots: string[] = [];
const alphaId = "71000000-0000-4000-8000-000000000001";
const bravoId = "71000000-0000-4000-8000-000000000002";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

test("streams one checksummed object under its durable download reservation", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);

  const stored = await store.put(new Blob(["alpha"]).stream(), 5, alphaId);

  expect(stored).toEqual({
    bytes: 5,
    objectKey: `source/${alphaId}`,
    sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8",
  });
  expect(await Bun.file(await store.openFile(stored.objectKey)).text()).toBe("alpha");
  expect(await readdir(join(root, "source"))).toEqual([alphaId]);
});

test("recovers and removes one completed reserved download", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);
  const stored = await store.put(new Blob(["alpha"]).stream(), 5, alphaId);

  expect(await store.recoverPut(alphaId, 5)).toEqual(stored);

  await store.remove(stored.objectKey);
  await store.remove(stored.objectKey);
  await expect(store.openFile(stored.objectKey)).rejects.toThrow("ENOENT");
});

test("removes an incomplete reservation before an approved reacquisition", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);
  await writeFile(join(root, `.put-${alphaId}`), "part");

  expect(await store.recoverPut(alphaId, 5)).toBeNull();
  await expect(store.put(new Blob(["alpha"]).stream(), 5, alphaId)).resolves.toMatchObject({
    bytes: 5,
  });
});

test("rejects a missing object before returning a lazy stream", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);

  await expect(
    store.openFile("sha256/8e/8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8")
  ).rejects.toThrow("ENOENT");
});

test("iterates finalized objects without reading their bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);
  const bravo = await store.put(new Blob(["bravo"]).stream(), 5, bravoId);
  const alpha = await store.put(new Blob(["alpha"]).stream(), 5, alphaId);
  await Bun.write(join(root, ".put-active"), "partial");

  expect(await Array.fromAsync(store.listObjectKeys())).toEqual(
    [alpha.objectKey, bravo.objectKey].sort()
  );
});

test("rejects an incomplete stream without retaining it", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const store = createLocalArtifactStore(root);

  await expect(store.put(new Blob(["short"]).stream(), 10, alphaId)).rejects.toThrow(
    "expected 10 bytes, received 5"
  );
  expect(await readdir(root)).toEqual([]);
});

test("cancels an oversized stream before retaining its bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
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

  const outcome = createLocalArtifactStore(root)
    .put(body, 5, alphaId)
    .catch((error: unknown) => error);
  await Bun.sleep(10);
  const entriesBeforeSourceCompletion = await readdir(root);
  if (!cancelled) {
    controller.close();
  }

  expect(await outcome).toHaveProperty("message", "Artifact expected 5 bytes, received 9");
  expect(cancelled).toBe(true);
  expect(entriesBeforeSourceCompletion).toEqual([]);
  expect(await readdir(root)).toEqual([]);
});

test("removes stale staging bytes without touching a recent writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmterminal-artifacts-"));
  roots.push(root);
  const stale = join(root, ".put-stale");
  const recent = join(root, ".put-recent");
  await Bun.write(stale, "orphaned");
  await Bun.write(recent, "active");
  await utimes(stale, new Date(0), new Date(0));
  const store = createLocalArtifactStore(root, { now: () => 10_000, stagingMaxAgeMs: 5000 });

  await store.put(new Blob(["alpha"]).stream(), 5, alphaId);

  expect((await readdir(root)).sort()).toEqual([".put-recent", "source"]);
});
