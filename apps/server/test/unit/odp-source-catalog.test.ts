import { expect, test } from "bun:test";

import { createOdpSourceCatalog } from "../../src/ingestion/odp-source-catalog.ts";
import {
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
} from "../../src/ingestion/source-catalog.ts";

const fixture = await Bun.file(new URL("../fixtures/odp-product.json", import.meta.url)).json();

test("maps the official ODP product shape to data artifacts", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => Promise.resolve(Response.json(fixture)),
  });

  const result = await catalog.discover("TRTDXFAP");

  expect(result.product).toEqual({
    frequency: "Daily",
    identifier: "TRTDXFAP",
    lastModifiedAt: "2024-09-26T12:00:00Z",
    title: "Trademark Daily XML Files",
  });
  expect(result.artifacts).toEqual([
    {
      bytes: 12_345,
      downloadUrl: "https://api.uspto.gov/api/v1/datasets/products/files/TRTDXFAP/apc240925.zip",
      filename: "apc240925.zip",
      fromDate: "2024-09-25",
      lastModifiedAt: "2024-09-26T11:30:00Z",
      releaseDate: "2024-09-26",
      toDate: "2024-09-25",
    },
  ]);
});

test("retains only sanitized response state from a rejected request", async () => {
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-persisted",
    fetch: () =>
      Promise.resolve(
        new Response('{"credential":"must-not-be-persisted"}', {
          headers: { "content-type": "application/json", "x-request-id": "request-123" },
          status: 403,
        })
      ),
  });

  try {
    await catalog.discover("TRTDXFAP");
    throw new Error("expected request rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as SourceHttpError).phase).toBe("catalog");
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
    fetch: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
  });

  await expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceTransportError);
});

test("rejects malformed source dates at the adapter boundary", async () => {
  const malformed = structuredClone(fixture);
  malformed.bulkDataProductBag[0].productFileBag.fileDataBag[0].fileDataFromDate = "not-a-date";
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => Promise.resolve(Response.json(malformed)),
  });

  await expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceContractError);
});

test("classifies an interrupted discovery body as a transport failure", async () => {
  const response = Response.json(fixture);
  Object.defineProperty(response, "json", {
    value: () => Promise.reject(new TypeError("terminated")),
  });
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => Promise.resolve(response),
  });

  await expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceTransportError);
});

test("classifies an interrupted download body as a transport failure", async () => {
  let request = 0;
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => {
      request += 1;
      if (request === 1) {
        return Promise.resolve(Response.redirect("https://data.uspto.gov/apc240925.zip", 302));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("terminated"));
            },
          })
        )
      );
    },
  });

  const download = await catalog.download("https://api.uspto.gov/files/apc240925.zip");
  await expect(download.body.getReader().read()).rejects.toBeInstanceOf(SourceTransportError);
});

test("rejects off-origin download URLs before they can receive the credential", async () => {
  const malicious = structuredClone(fixture);
  malicious.bulkDataProductBag[0].productFileBag.fileDataBag[0].fileDownloadURI =
    "https://example.com/stolen.zip";
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-forwarded",
    fetch: () => Promise.resolve(Response.json(malicious)),
  });

  await expect(catalog.discover("TRTDXFAP")).rejects.toBeInstanceOf(SourceContractError);
});

test("follows the USPTO data redirect without forwarding the credential", async () => {
  const requests: Array<{
    apiKey: string | null;
    redirect: RequestRedirect | undefined;
    url: string;
  }> = [];
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-forwarded",
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({ apiKey: headers.get("x-api-key"), redirect: init?.redirect, url });
      if (requests.length === 1) {
        return Promise.resolve(Response.redirect("https://data.uspto.gov/apc240925.zip", 302));
      }
      return Promise.resolve(new Response("zip", { headers: { "content-length": "3" } }));
    },
  });

  await catalog.download("https://api.uspto.gov/files/apc240925.zip");

  expect(requests).toEqual([
    {
      apiKey: "must-not-be-forwarded",
      redirect: "manual",
      url: "https://api.uspto.gov/files/apc240925.zip",
    },
    { apiKey: null, redirect: "manual", url: "https://data.uspto.gov/apc240925.zip" },
  ]);
});

test("normalizes a bounded download-redirect quota response", async () => {
  const providerMessage =
    "This URI has been requested 15 times. Please wait 604800 seconds before trying again.";
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => Promise.resolve(Response.json(providerMessage, { status: 429 })),
  });

  try {
    await catalog.download("https://api.uspto.gov/files/apc240925.zip");
    throw new Error("expected request rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as SourceHttpError).phase).toBe("download-redirect");
    expect((error as SourceHttpError).responseState).toEqual({
      contentType: "application/json;charset=utf-8",
      providerRequestCount: 15,
      retryAfterSeconds: 604_800,
      status: 429,
    });
    expect(JSON.stringify(error)).not.toContain(providerMessage);
  }
});

test("falls back when a download-redirect quota body is unusable", async () => {
  const bodies = [
    null,
    "not-json",
    JSON.stringify("The provider changed this message."),
    JSON.stringify(`This URI has been requested 15 times. Wait ${"6".repeat(5000)} seconds.`),
  ];
  const states = await Promise.all(
    bodies.map(async (body) => {
      const catalog = createOdpSourceCatalog({
        apiKey: "test-key",
        fetch: () => Promise.resolve(new Response(body, { status: 429 })),
      });
      try {
        await catalog.download("https://api.uspto.gov/files/apc240925.zip");
        throw new Error("expected request rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(SourceHttpError);
        return (error as SourceHttpError).responseState;
      }
    })
  );

  expect(states).toEqual([{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
});

test("identifies a data-origin 429 as a provider throttle", async () => {
  let request = 0;
  const catalog = createOdpSourceCatalog({
    apiKey: "test-key",
    fetch: () => {
      request += 1;
      if (request === 1) {
        return Promise.resolve(Response.redirect("https://data.uspto.gov/apc240925.zip", 302));
      }
      return Promise.resolve(new Response(null, { headers: { "retry-after": "60" }, status: 429 }));
    },
  });

  try {
    await catalog.download("https://api.uspto.gov/files/apc240925.zip");
    throw new Error("expected request rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(SourceHttpError);
    expect((error as SourceHttpError).phase).toBe("download-data");
    expect((error as SourceHttpError).responseState).toEqual({
      retryAfter: "60",
      status: 429,
    });
  }
});

test("rejects redirects outside the USPTO data origin without forwarding the credential", async () => {
  let requests = 0;
  const catalog = createOdpSourceCatalog({
    apiKey: "must-not-be-forwarded",
    fetch: () => {
      requests += 1;
      return Promise.resolve(Response.redirect("https://example.com/stolen.zip", 302));
    },
  });

  await expect(
    catalog.download("https://api.uspto.gov/files/apc240925.zip")
  ).rejects.toBeInstanceOf(SourceContractError);
  expect(requests).toBe(1);
});
