import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { ArtifactIntegrityError, type ArtifactStore } from "./artifact-store.ts";

const objectKeyPattern = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/;

function objectPath(root: string, objectKey: string) {
  if (!objectKeyPattern.test(objectKey)) {
    throw new Error(`Invalid artifact object key: ${objectKey}`);
  }
  return join(root, objectKey);
}

export function createLocalArtifactStore(
  root: string,
  options: { now?: () => number; stagingMaxAgeMs?: number } = {},
): ArtifactStore {
  const now = options.now ?? Date.now;
  const stagingMaxAgeMs = options.stagingMaxAgeMs ?? 24 * 60 * 60 * 1_000;

  async function cleanStaleStagingFiles() {
    await mkdir(root, { recursive: true });
    for (const name of await readdir(root)) {
      if (!name.startsWith(".put-")) continue;
      const path = join(root, name);
      const details = await stat(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (details && now() - details.mtimeMs >= stagingMaxAgeMs) {
        await unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    }
  }

  return {
    async put(body, expectedBytes) {
      const temporaryPath = join(root, `.put-${randomUUID()}`);
      await cleanStaleStagingFiles();
      const file = await open(temporaryPath, "wx");
      const hash = createHash("sha256");
      const reader = body.getReader();
      let bytes = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (expectedBytes !== null && bytes > expectedBytes) {
            const error = new ArtifactIntegrityError(`Artifact expected ${expectedBytes} bytes, received ${bytes}`);
            await reader.cancel(error);
            throw error;
          }
          hash.update(value);
          let written = 0;
          while (written < value.byteLength) {
            const result = await file.write(value, written, value.byteLength - written);
            written += result.bytesWritten;
          }
        }
        await file.sync();
      } catch (error) {
        await file.close();
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
      await file.close();

      if (expectedBytes !== null && bytes !== expectedBytes) {
        await unlink(temporaryPath);
        throw new ArtifactIntegrityError(`Artifact expected ${expectedBytes} bytes, received ${bytes}`);
      }

      const sha256 = hash.digest("hex");
      const objectKey = `sha256/${sha256.slice(0, 2)}/${sha256}`;
      const destination = objectPath(root, objectKey);
      await mkdir(join(root, "sha256", sha256.slice(0, 2)), { recursive: true });
      const existing = await stat(destination).catch(() => null);
      if (existing) {
        await unlink(temporaryPath);
      } else {
        await rename(temporaryPath, destination);
      }
      return { bytes, objectKey, sha256 };
    },

    async get(objectKey) {
      return Bun.file(objectPath(root, objectKey)).stream();
    },

    async head(objectKey) {
      const details = await stat(objectPath(root, objectKey)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      return details ? { bytes: details.size } : null;
    },
  };
}
