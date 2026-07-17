import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import { extractZipXml } from "../../src/ingestion/zip-artifact-xml.ts";

const zip = Buffer.from(
  "UEsDBBQAAAAIAAGC71wx4IigDQAAAA8AAAAKABwAc291cmNlLnhtbFVUCQADgupXaoLqV2p1eAsAAQT1AQAABAAAAACzKcrPL7HLz7bRBzMAUEsBAh4DFAAAAAgAAYLvXDHgiKANAAAADwAAAAoAGAAAAAAAAQAAAKSBAAAAAHNvdXJjZS54bWxVVAUAA4LqV2p1eAsAAQT1AQAABAAAAABQSwUGAAAAAAEAAQBQAAAAUQAAAAAA",
  "base64"
);
const noXmlZip = Buffer.from(
  "UEsDBAoAAAAAAEeH71zHp4s7BAAAAAQAAAAKABwAcmVhZG1lLnR4dFVUCQADZvRXamb0V2p1eAsAAQT1AQAABBQAAAB0ZXh0UEsBAh4DCgAAAAAAR4fvXMenizsEAAAABAAAAAoAGAAAAAAAAQAAAKSBAAAAAHJlYWRtZS50eHRVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBQAAAASAAAAAAA",
  "base64"
);
const multipleXmlZip = Buffer.from(
  "UEsDBAoAAAAAAEeH71zUHNEBBAAAAAQAAAAFABwAYS54bWxVVAkAA2b0V2pm9FdqdXgLAAEE9QEAAAQUAAAAPGEvPlBLAwQKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAcAGIueG1sVVQJAANm9FdqZvRXanV4CwABBPUBAAAEFAAAADxiLz5QSwECHgMKAAAAAABHh+9c1BzRAQQAAAAEAAAABQAYAAAAAAABAAAApIEAAAAAYS54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAYAAAAAAABAAAApIFDAAAAYi54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCWAAAAhgAAAAAA",
  "base64"
);
const corruptXmlZip = Buffer.from(zip);
corruptXmlZip.fill(0, 68, 81);
const commentedXmlZip = Buffer.concat([zip, Buffer.alloc(100, "c")]);
commentedXmlZip.writeUInt16LE(100, zip.byteLength - 2);
const embeddedEocdXmlZip = Buffer.from(
  "UEsDBAoAAAAAAAuK8Fzv45ICBAAAAAQAAAAJAAAAZmFsc2UuYmluUEsFBlBLAwQKAAAAAAALivBcMeCIoA8AAAAPAAAACgAAAHNvdXJjZS54bWw8cm9vdD5vazwvcm9vdD5QSwECHgMKAAAAAAALivBc7+OSAgQAAAAEAAAACQAAAAAAAAAAAAAApIEAAAAAZmFsc2UuYmluUEsBAh4DCgAAAAAAC4rwXDHgiKAPAAAADwAAAAoAAAAAAAAAAAAAAKSBKwAAAHNvdXJjZS54bWxQSwUGAAAAAAIAAgBvAAAAYgAAAAAA",
  "base64"
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function retainArchive(bytes: Uint8Array) {
  const root = await mkdtemp(join(tmpdir(), "tmturtle-archive-"));
  roots.push(root);
  const path = join(root, "source.zip");
  await Bun.write(path, bytes);
  return path;
}

test("streams the sole XML entry from a path-backed ZIP after a consumer pause", async () => {
  const archivePath = await retainArchive(zip);
  const xml = await extractZipXml(archivePath);
  await Bun.sleep(20);

  expect(await new Response(Readable.toWeb(xml) as unknown as BodyInit).text()).toBe(
    "<root>ok</root>"
  );
});

test("opens a valid ZIP with a comment beyond unzipper's default tail", async () => {
  const archivePath = await retainArchive(commentedXmlZip);

  expect(
    await new Response(
      Readable.toWeb(await extractZipXml(archivePath)) as unknown as BodyInit
    ).text()
  ).toBe("<root>ok</root>");
});

test("ignores an EOCD signature embedded before the real trailing directory", async () => {
  const archivePath = await retainArchive(embeddedEocdXmlZip);

  expect(
    await new Response(
      Readable.toWeb(await extractZipXml(archivePath)) as unknown as BodyInit
    ).text()
  ).toBe("<root>ok</root>");
});

test("rejects a retained artifact that is not a ZIP", async () => {
  const archivePath = await retainArchive(new TextEncoder().encode("not a zip"));
  await expect(extractZipXml(archivePath)).rejects.toThrow("Artifact ZIP is invalid");
});

test("maps a corrupt XML entry to the archive error contract", async () => {
  const archivePath = await retainArchive(corruptXmlZip);
  const xml = await extractZipXml(archivePath);

  await expect(new Response(Readable.toWeb(xml) as unknown as BodyInit).text()).rejects.toThrow(
    "Artifact ZIP is invalid"
  );
});

test("rejects ZIPs without exactly one XML file", async () => {
  const noXmlPath = await retainArchive(noXmlZip);
  const multipleXmlPath = await retainArchive(multipleXmlZip);

  await expect(extractZipXml(noXmlPath)).rejects.toThrow("Artifact ZIP contains no XML file");
  await expect(extractZipXml(multipleXmlPath)).rejects.toThrow(
    "Artifact ZIP contains more than one XML file"
  );
});
