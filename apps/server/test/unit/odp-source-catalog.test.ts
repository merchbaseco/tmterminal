import { expect, test } from "bun:test";

import { createOdpSourceCatalog } from "../../src/ingestion/odp-source-catalog.ts";
import { SourceContractError, SourceHttpError, SourceTransportError } from "../../src/ingestion/source-catalog.ts";

const fixture = await Bun.file(new URL("../fixtures/odp-product.json", import.meta.url)).json();

test("maps the official ODP product shape to data artifacts", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: async () => Response.json(fixture),
  });

  const result = await catalog.discover("TRTDXFAP");

  expect(result.product).toEqual({
    identifier: "TRTDXFAP",
    title: "Trademark Daily XML Files",
    frequency: "Daily",
    lastModifiedAt: "2024-09-26T12:00:00Z",
  });
  expect(result.artifacts).toEqual([
    {
      filename: "apc240925.zip",
      bytes: 12345,
      downloadUrl: "https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/apc240925.zip",
      fromDate: "2024-09-25",
      toDate: "2024-09-25",
      releaseDate: "2024-09-26",
      lastModifiedAt: "2024-09-26T11:30:00Z",
    },
  ]);
});

test("retains only sanitized response state from a rejected request", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-persisted",
    fetch: async () =>
      new Response('{"credential":"must-not-be-persisted"}', {
        headers: { "content-type": "application/json", "x-request-id": "request-123" },
        status: 403,
      }),
  });

  try {
    await catalog.discover("TRTDXFAP");
    throw new Error("expected request rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as SourceHttpError).responseState).toEqual({
      contentType: "application/json",
      requestId: "request-123",
      status: 403,
    });
    expect(JSON.stringify(error)).not.toContain("must-not-be-persisted");
  }
});

test("classifies request timeouts as retryable transport failures", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: async () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  });

  expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceTransportError);
});

test("rejects malformed source dates at the adapter boundary", async () => {
  const malformed = structuredClone(fixture);
  malformed.bulkDataProductBag[0].productFileBag.fileDataBag[0].fileDataFromDate = "not-a-date";
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: async () => Response.json(malformed),
  });

  expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceContractError);
});

test("classifies an interrupted discovery body as a transport failure", async () => {
  const response = Response.json(fixture);
  Object.defineProperty(response, "json", {
    value: async () => {
      throw new TypeError("terminated");
    },
  });
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: async () => response,
  });

  expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceTransportError);
});

test("classifies an interrupted download body as a transport failure", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("terminated"));
          },
        }),
      ),
  });

  const download = await catalog.download("https://api.uspto.gov/files/apc240925.zip");
  expect(download.body.getReader().read()).rejects.toBeInstanceOf(SourceTransportError);
});

test("rejects off-origin download URLs before they can receive the credential", async () => {
  const malicious = structuredClone(fixture);
  malicious.bulkDataProductBag[0].productFileBag.fileDataBag[0].fileDownloadURI = "https://example.com/stolen.zip";
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-forwarded",
    fetch: async () => Response.json(malicious),
  });

  expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceContractError);
});

test("does not automatically follow download redirects with the credential", async () => {
  let redirect: RequestRedirect | undefined;
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-forwarded",
    fetch: async (_url, init) => {
      redirect = init?.redirect;
      return new Response(null, { headers: { location: "https://example.com/stolen.zip" }, status: 302 });
    },
  });

  expect(catalog.download("https://api.uspto.gov/files/apc240925.zip")).rejects.toBeInstanceOf(SourceHttpError);
  expect(redirect).toBe("manual");
});
