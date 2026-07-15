import { expect, test } from "bun:test";

import { extractZipXml } from "../../src/ingestion/zip-artifact-xml.ts";

const zip = Buffer.from(
  "UEsDBBQAAAAIAAGC71wx4IigDQAAAA8AAAAKABwAc291cmNlLnhtbFVUCQADgupXaoLqV2p1eAsAAQT1AQAABAAAAACzKcrPL7HLz7bRBzMAUEsBAh4DFAAAAAgAAYLvXDHgiKANAAAADwAAAAoAGAAAAAAAAQAAAKSBAAAAAHNvdXJjZS54bWxVVAUAA4LqV2p1eAsAAQT1AQAABAAAAABQSwUGAAAAAAEAAQBQAAAAUQAAAAAA",
  "base64",
);
const noXmlZip = Buffer.from("UEsDBAoAAAAAAEeH71zHp4s7BAAAAAQAAAAKABwAcmVhZG1lLnR4dFVUCQADZvRXamb0V2p1eAsAAQT1AQAABBQAAAB0ZXh0UEsBAh4DCgAAAAAAR4fvXMenizsEAAAABAAAAAoAGAAAAAAAAQAAAKSBAAAAAHJlYWRtZS50eHRVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAEAAQBQAAAASAAAAAAA", "base64");
const multipleXmlZip = Buffer.from("UEsDBAoAAAAAAEeH71zUHNEBBAAAAAQAAAAFABwAYS54bWxVVAkAA2b0V2pm9FdqdXgLAAEE9QEAAAQUAAAAPGEvPlBLAwQKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAcAGIueG1sVVQJAANm9FdqZvRXanV4CwABBPUBAAAEFAAAADxiLz5QSwECHgMKAAAAAABHh+9c1BzRAQQAAAAEAAAABQAYAAAAAAABAAAApIEAAAAAYS54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAABHh+9cjaKXAwQAAAAEAAAABQAYAAAAAAABAAAApIFDAAAAYi54bWxVVAUAA2b0V2p1eAsAAQT1AQAABBQAAABQSwUGAAAAAAIAAgCWAAAAhgAAAAAA", "base64");

test("streams the sole XML file from a retained ZIP", async () => {
  const archive = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(zip);
      controller.close();
    },
  });

  expect(await new Response(extractZipXml(archive)).text()).toBe("<root>ok</root>");
});

test("rejects a retained artifact that is not a ZIP", async () => {
  const archive = new Blob(["not a zip"]).stream();
  await expect(new Response(extractZipXml(archive)).text()).rejects.toThrow("Artifact ZIP is invalid");
});

test("rejects ZIPs without exactly one XML file", async () => {
  await expect(new Response(extractZipXml(new Blob([noXmlZip]).stream())).text()).rejects.toThrow(
    "Artifact ZIP contains no XML file",
  );
  await expect(new Response(extractZipXml(new Blob([multipleXmlZip]).stream())).text()).rejects.toThrow(
    "Artifact ZIP contains more than one XML file",
  );
});
