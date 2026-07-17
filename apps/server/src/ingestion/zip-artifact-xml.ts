import { open } from "node:fs/promises";
import { createRequire } from "node:module";
import { PassThrough, type Readable } from "node:stream";

const loadModule = createRequire(import.meta.url);
const Open = loadModule("unzipper").Open as {
  file: (path: string, options: { tailSize: number }) => Promise<{ files: ZipEntry[] }>;
};
const zipEndOfCentralDirectoryBytes = 22;
const zipMaxCommentBytes = 65_535;
const zipCentralDirectoryTailBytes = zipEndOfCentralDirectoryBytes + zipMaxCommentBytes;
const zipEndOfCentralDirectorySignature = 0x06_05_4b_50;

interface ZipEntry {
  path: string;
  stream: () => Readable;
  type: string;
}

export class ArtifactArchiveError extends Error {}

export async function extractZipXml(archivePath: string) {
  let files: ZipEntry[];
  try {
    const tailSize = await findZipEndOfCentralDirectory(archivePath);
    ({ files } = await Open.file(archivePath, { tailSize }));
  } catch (error) {
    throw new ArtifactArchiveError("Artifact ZIP is invalid", { cause: error });
  }
  const xmlEntries = files.filter(
    (candidate) => candidate.type === "File" && candidate.path.toLowerCase().endsWith(".xml")
  );
  if (xmlEntries.length === 0) {
    throw new ArtifactArchiveError("Artifact ZIP contains no XML file");
  }
  if (xmlEntries.length > 1) {
    throw new ArtifactArchiveError("Artifact ZIP contains more than one XML file");
  }
  const [entry] = xmlEntries as [ZipEntry];
  return mapArchiveErrors(entry.stream());
}

function mapArchiveErrors(stream: Readable) {
  const mapped = new PassThrough();
  stream.once("error", (error) => {
    mapped.destroy(new ArtifactArchiveError("Artifact ZIP is invalid", { cause: error }));
  });
  mapped.once("close", () => stream.destroy());
  return stream.pipe(mapped);
}

async function findZipEndOfCentralDirectory(archivePath: string) {
  const archive = await open(archivePath, "r");
  try {
    const { size } = await archive.stat();
    const tailSize = Math.min(size, zipCentralDirectoryTailBytes);
    const tail = Buffer.allocUnsafe(tailSize);
    let bytesRead = 0;
    while (bytesRead < tailSize) {
      // biome-ignore lint/performance/noAwaitInLoops: One bounded tail buffer must be filled in file order.
      const result = await archive.read(
        tail,
        bytesRead,
        tailSize - bytesRead,
        size - tailSize + bytesRead
      );
      if (result.bytesRead === 0) {
        throw new Error("Artifact ZIP ended before its central directory");
      }
      bytesRead += result.bytesRead;
    }
    for (let offset = tailSize - zipEndOfCentralDirectoryBytes; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== zipEndOfCentralDirectorySignature) {
        continue;
      }
      const commentBytes = tail.readUInt16LE(offset + 20);
      const candidateTailSize = tailSize - offset;
      if (candidateTailSize === zipEndOfCentralDirectoryBytes + commentBytes) {
        return candidateTailSize;
      }
    }
    throw new Error("Artifact ZIP has no end-of-central-directory record");
  } finally {
    await archive.close();
  }
}
