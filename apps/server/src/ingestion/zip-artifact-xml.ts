import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const Parse = require("unzipper/lib/parse") as (options: { forceStream: boolean }) => NodeJS.ReadWriteStream;

type ZipEntry = NodeJS.ReadableStream & AsyncIterable<Uint8Array> & {
  type: string;
  path: string;
  autodrain(): { promise(): Promise<void> };
};

export class ArtifactArchiveError extends Error {}

export function extractZipXml(archive: ReadableStream<Uint8Array>) {
  const output = new PassThrough();
  const parser = Readable.fromWeb(archive as unknown as NodeReadableStream<Uint8Array>)
    .pipe(Parse({ forceStream: true }));

  void (async () => {
    let found = false;
    try {
      for await (const entry of parser as AsyncIterable<ZipEntry>) {
        if (entry.type !== "File" || !entry.path.toLowerCase().endsWith(".xml")) {
          await entry.autodrain().promise();
          continue;
        }
        if (found) throw new ArtifactArchiveError("Artifact ZIP contains more than one XML file");
        found = true;
        for await (const chunk of entry) {
          if (!output.write(chunk)) await once(output, "drain");
        }
      }
      if (!found) throw new ArtifactArchiveError("Artifact ZIP contains no XML file");
      output.end();
    } catch (error) {
      output.destroy(error instanceof ArtifactArchiveError
        ? error
        : new ArtifactArchiveError("Artifact ZIP is invalid"));
    }
  })();

  return Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;
}
