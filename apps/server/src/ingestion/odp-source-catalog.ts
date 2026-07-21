import { z } from "zod";

import {
  type SourceCatalog,
  SourceContractError,
  SourceHttpError,
  type SourceResponseState,
  SourceTransportError,
} from "./source-catalog.ts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const odpOrigin = "https://api.uspto.gov";
const odpDataOrigin = "https://data.uspto.gov";
const maximumErrorBodyBytes = 4096;
const maximumRetryAfterSeconds = 365 * 24 * 60 * 60;
const odpDownloadUrl = z.url().refine((value) => new URL(value).origin === odpOrigin);
const odpDataDownloadUrl = z.url().refine((value) => new URL(value).origin === odpDataOrigin);
const odpTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  .transform((value) => `${value.slice(0, 10)}T${value.slice(11)}Z`)
  .pipe(z.iso.datetime({ offset: true }));
const odpReleaseDate = odpTimestamp.transform((value) => value.slice(0, 10)).pipe(z.iso.date());
const quotaUriPattern = /\bURI\b/i;
const quotaValuesPattern = /requested\s+(\d+)\s+times\b[\s\S]*?\bwait\s+(\d+)\s+seconds\b/i;

const fileSchema = z.object({
  fileDataFromDate: z.iso.date(),
  fileDataToDate: z.iso.date(),
  fileDownloadURI: z.url(),
  fileLastModifiedDateTime: odpTimestamp,
  fileName: z.string(),
  fileReleaseDate: odpReleaseDate,
  fileSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  fileTypeText: z.string(),
});

const productResponseSchema = z.object({
  bulkDataProductBag: z.array(
    z.object({
      lastModifiedDateTime: odpTimestamp,
      productFileBag: z.object({
        fileDataBag: z.array(fileSchema),
      }),
      productFrequencyText: z.string(),
      productIdentifier: z.string(),
      productTitleText: z.string(),
    })
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
    if (value) {
      state[key] = value;
    }
  }
  if (!state.rateLimitReset) {
    const value =
      response.headers.get("x-ratelimit-reset") ?? response.headers.get("x-rate-limit-reset");
    if (value) {
      state.rateLimitReset = value;
    }
  }
  return state;
}

async function fileQuotaState(response: Response) {
  const body = await boundedResponseText(response);
  if (!body) {
    return {};
  }
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return {};
  }
  if (typeof message !== "string" || !quotaUriPattern.test(message)) {
    return {};
  }
  const match = quotaValuesPattern.exec(message);
  const providerRequestCount = Number(match?.[1]);
  const retryAfterSeconds = Number(match?.[2]);
  if (
    !Number.isSafeInteger(providerRequestCount) ||
    providerRequestCount < 1 ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    retryAfterSeconds < 1 ||
    retryAfterSeconds > maximumRetryAfterSeconds
  ) {
    return {};
  }
  return { providerRequestCount, retryAfterSeconds };
}

async function boundedResponseText(response: Response) {
  if (!response.body) {
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      byteCount += chunk.value.byteLength;
      if (byteCount > maximumErrorBodyBytes) {
        return reader.cancel().then(
          () => null,
          () => null
        );
      }
      chunks.push(chunk.value);
      // biome-ignore lint/performance/noAwaitInLoops: A response stream must be read sequentially.
      chunk = await reader.read();
    }
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const storedChunk of chunks) {
      bytes.set(storedChunk, offset);
      offset += storedChunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function rejectedDownloadState(response: Response) {
  const state = responseState(response);
  if (response.status === 429) {
    Object.assign(state, await fileQuotaState(response));
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
        if (chunk.done) {
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        controller.error(sourceTransportError(error) ?? error);
      }
    },
  });
}

async function send(
  fetcher: Fetch,
  input: string,
  headers: Record<string, string>,
  timeoutMs: number
) {
  let response: Response;
  try {
    response = await fetcher(input, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const transportError = sourceTransportError(error);
    if (transportError) {
      throw transportError;
    }
    throw error;
  }

  return response;
}

async function request(
  fetcher: Fetch,
  input: string,
  apiKey: string,
  accept: string,
  timeoutMs: number
) {
  const response = await send(fetcher, input, { accept, "x-api-key": apiKey }, timeoutMs);
  if (response.ok) {
    return response;
  }
  throw new SourceHttpError(
    `USPTO ODP request failed with HTTP ${response.status}`,
    responseState(response),
    "catalog"
  );
}

export function createOdpSourceCatalog(options: {
  apiKey: string;
  fetch?: Fetch;
  timeoutMs?: number;
}): SourceCatalog {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async discover(productIdentifier) {
      const response = await request(
        fetcher,
        `https://api.uspto.gov/api/v1/datasets/products/${encodeURIComponent(productIdentifier)}`,
        options.apiKey,
        "application/json",
        timeoutMs
      );
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        const transportError = sourceTransportError(error);
        if (transportError) {
          throw transportError;
        }
        throw new SourceContractError(`USPTO ODP returned invalid JSON for ${productIdentifier}`, {
          cause: error,
        });
      }
      const parsed = productResponseSchema.safeParse(body);
      const product = parsed.data?.bulkDataProductBag.find(
        (candidate) => candidate.productIdentifier === productIdentifier
      );
      if (!(parsed.success && product)) {
        throw new SourceContractError(
          `USPTO ODP returned an invalid ${productIdentifier} product response`
        );
      }
      const dataFiles = product.productFileBag.fileDataBag.filter(
        (file) => file.fileTypeText.toLowerCase() === "data"
      );
      if (dataFiles.some((file) => !odpDownloadUrl.safeParse(file.fileDownloadURI).success)) {
        throw new SourceContractError(
          `USPTO ODP returned an unauthorized ${productIdentifier} download URL`
        );
      }

      return {
        artifacts: dataFiles.map((file) => ({
          bytes: file.fileSize,
          downloadUrl: file.fileDownloadURI,
          filename: file.fileName,
          fromDate: file.fileDataFromDate,
          lastModifiedAt: file.fileLastModifiedDateTime,
          releaseDate: file.fileReleaseDate,
          toDate: file.fileDataToDate,
        })),
        product: {
          frequency: product.productFrequencyText,
          identifier: product.productIdentifier,
          lastModifiedAt: product.lastModifiedDateTime,
          title: product.productTitleText,
        },
        responseState: responseState(response),
      };
    },

    async download({ filename, product }) {
      const downloadUrl = `${odpOrigin}/api/v1/datasets/products/files/${encodeURIComponent(product)}/${encodeURIComponent(filename)}`;
      if (!odpDownloadUrl.safeParse(downloadUrl).success) {
        throw new SourceContractError("USPTO ODP download identity is invalid");
      }
      const redirect = await send(
        fetcher,
        downloadUrl,
        { accept: "application/octet-stream", "x-api-key": options.apiKey },
        timeoutMs
      );
      if (redirect.status !== 302) {
        throw new SourceHttpError(
          `USPTO ODP download redirect failed with HTTP ${redirect.status}`,
          await rejectedDownloadState(redirect),
          "download-redirect"
        );
      }
      const location = redirect.headers.get("location");
      if (!location) {
        throw new SourceContractError("USPTO ODP data download redirect is missing a location");
      }
      let redirectedUrl: string;
      try {
        redirectedUrl = new URL(location, downloadUrl).toString();
      } catch (error) {
        throw new SourceContractError("USPTO ODP returned an invalid data download redirect", {
          cause: error,
        });
      }
      if (!odpDataDownloadUrl.safeParse(redirectedUrl).success) {
        throw new SourceContractError("USPTO ODP returned an unauthorized data download redirect");
      }
      const response = await send(
        fetcher,
        redirectedUrl,
        { accept: "application/octet-stream" },
        timeoutMs
      );
      if (!response.ok) {
        throw new SourceHttpError(
          `USPTO ODP data download failed with HTTP ${response.status}`,
          responseState(response),
          "download-data"
        );
      }
      if (!response.body) {
        throw new SourceTransportError("USPTO ODP download response had no body");
      }
      const contentLength = response.headers.get("content-length");
      if (
        contentLength !== null &&
        (!Number.isSafeInteger(Number(contentLength)) || Number(contentLength) < 0)
      ) {
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
