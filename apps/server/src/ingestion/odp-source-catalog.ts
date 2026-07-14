import { z } from "zod";

import {
  SourceContractError,
  SourceHttpError,
  SourceTransportError,
  type SourceCatalog,
  type SourceResponseState,
} from "./source-catalog.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const odpOrigin = "https://api.uspto.gov";
const odpDownloadUrl = z.url().refine((value) => new URL(value).origin === odpOrigin);

const fileSchema = z.object({
  fileName: z.string(),
  fileSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fileDataFromDate: z.iso.date(),
  fileDataToDate: z.iso.date(),
  fileTypeText: z.string(),
  fileDownloadURI: z.url(),
  fileReleaseDate: z.iso.date(),
  fileLastModifiedDateTime: z.iso.datetime({ offset: true }),
});

const productResponseSchema = z.object({
  bulkDataProductBag: z.array(
    z.object({
      productIdentifier: z.string(),
      productTitleText: z.string(),
      productFrequencyText: z.string(),
      lastModifiedDateTime: z.iso.datetime({ offset: true }),
      productFileBag: z.object({
        fileDataBag: z.array(fileSchema),
      }),
    }),
  ),
});

function responseState(response: Response): SourceResponseState {
  const state: SourceResponseState = { status: response.status };
  const fields = [
    ["contentLength", "content-length"],
    ["contentType", "content-type"],
    ["etag", "etag"],
    ["requestId", "x-request-id"],
    ["retryAfter", "retry-after"],
    ["rateLimitReset", "ratelimit-reset"],
  ] as const;

  for (const [key, header] of fields) {
    const value = response.headers.get(header);
    if (value) state[key] = value;
  }
  if (!state.rateLimitReset) {
    const value = response.headers.get("x-ratelimit-reset") ?? response.headers.get("x-rate-limit-reset");
    if (value) state.rateLimitReset = value;
  }
  return state;
}

function sourceTransportError(error: unknown) {
  if (
    error instanceof TypeError ||
    ((error instanceof Error || error instanceof DOMException) &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  ) {
    return new SourceTransportError(error.message);
  }
  return null;
}

function transportBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason);
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(sourceTransportError(error) ?? error);
      }
    },
  });
}

async function request(fetcher: Fetch, input: string, apiKey: string, accept: string, timeoutMs: number) {
  let response: Response;
  try {
    response = await fetcher(input, {
      headers: { accept, "x-api-key": apiKey },
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const transportError = sourceTransportError(error);
    if (transportError) throw transportError;
    throw error;
  }

  if (!response.ok) {
    throw new SourceHttpError(`USPTO ODP request failed with HTTP ${response.status}`, responseState(response));
  }
  return response;
}

export function createOdpSourceCatalog(options: { apiKey: string; fetch?: Fetch; timeoutMs?: number }): SourceCatalog {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async discover(productIdentifier) {
      const response = await request(
        fetcher,
        `https://api.uspto.gov/api/v1/datasets/products/${encodeURIComponent(productIdentifier)}`,
        options.apiKey,
        "application/json",
        timeoutMs,
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        const transportError = sourceTransportError(error);
        if (transportError) throw transportError;
        throw new SourceContractError(`USPTO ODP returned invalid JSON for ${productIdentifier}`);
      }
      const parsed = productResponseSchema.safeParse(body);
      const product = parsed.data?.bulkDataProductBag.find(
        (candidate) => candidate.productIdentifier === productIdentifier,
      );
      if (!parsed.success || !product) {
        throw new SourceContractError(`USPTO ODP returned an invalid ${productIdentifier} product response`);
      }
      const dataFiles = product.productFileBag.fileDataBag.filter((file) => file.fileTypeText.toLowerCase() === "data");
      if (dataFiles.some((file) => !odpDownloadUrl.safeParse(file.fileDownloadURI).success)) {
        throw new SourceContractError(`USPTO ODP returned an unauthorized ${productIdentifier} download URL`);
      }

      return {
        product: {
          identifier: product.productIdentifier,
          title: product.productTitleText,
          frequency: product.productFrequencyText,
          lastModifiedAt: product.lastModifiedDateTime,
        },
        artifacts: dataFiles.map((file) => ({
            filename: file.fileName,
            bytes: file.fileSize,
            downloadUrl: file.fileDownloadURI,
            fromDate: file.fileDataFromDate,
            toDate: file.fileDataToDate,
            releaseDate: file.fileReleaseDate,
            lastModifiedAt: file.fileLastModifiedDateTime,
          })),
        responseState: responseState(response),
      };
    },

    async download(downloadUrl) {
      if (!odpDownloadUrl.safeParse(downloadUrl).success) {
        throw new SourceContractError("USPTO ODP returned an unauthorized download URL");
      }
      const response = await request(fetcher, downloadUrl, options.apiKey, "application/octet-stream", timeoutMs);
      if (!response.body) {
        throw new SourceTransportError("USPTO ODP download response had no body");
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && (!Number.isSafeInteger(Number(contentLength)) || Number(contentLength) < 0)) {
        throw new SourceContractError("USPTO ODP download returned an invalid content-length");
      }
      return {
        body: transportBody(response.body),
        expectedBytes: contentLength === null ? null : Number(contentLength),
        responseState: responseState(response),
      };
    },
  };
}
