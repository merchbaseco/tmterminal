export interface SourceResponseState {
  contentLength?: string;
  contentType?: string;
  etag?: string;
  observedAt?: string;
  providerRequestCount?: number;
  rateLimitReset?: string;
  requestId?: string;
  retryAfter?: string;
  retryAfterSeconds?: number;
  retryNotBefore?: string;
  status: number;
}

export interface DiscoveredArtifact {
  bytes: number;
  downloadUrl: string;
  filename: string;
  fromDate: string;
  lastModifiedAt: string;
  releaseDate: string;
  toDate: string;
}

export interface DiscoveredProduct {
  artifacts: DiscoveredArtifact[];
  product: {
    frequency: string;
    identifier: string;
    lastModifiedAt: string;
    title: string;
  };
  responseState: SourceResponseState;
}

export interface ArtifactDownload {
  body: ReadableStream<Uint8Array>;
  expectedBytes: number | null;
  responseState: SourceResponseState;
}

export interface SourceCatalog {
  discover: (productIdentifier: string) => Promise<DiscoveredProduct>;
  download: (identity: { filename: string; product: string }) => Promise<ArtifactDownload>;
}

export class SourceHttpError extends Error {
  readonly phase: "catalog" | "download-data" | "download-redirect";
  readonly responseState: SourceResponseState;

  constructor(
    message: string,
    responseState: SourceResponseState,
    phase: "catalog" | "download-data" | "download-redirect"
  ) {
    super(message);
    this.name = "SourceHttpError";
    this.phase = phase;
    this.responseState = responseState;
  }
}

export class SourceTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTransportError";
  }
}

export class SourceContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceContractError";
  }
}
