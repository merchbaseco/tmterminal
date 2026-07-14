export type SourceResponseState = {
  contentLength?: string;
  contentType?: string;
  etag?: string;
  rateLimitReset?: string;
  requestId?: string;
  retryAfter?: string;
  status: number;
};

export type DiscoveredArtifact = {
  bytes: number;
  downloadUrl: string;
  filename: string;
  fromDate: string;
  lastModifiedAt: string;
  releaseDate: string;
  toDate: string;
};

export type DiscoveredProduct = {
  artifacts: DiscoveredArtifact[];
  product: {
    frequency: string;
    identifier: string;
    lastModifiedAt: string;
    title: string;
  };
  responseState: SourceResponseState;
};

export type ArtifactDownload = {
  body: ReadableStream<Uint8Array>;
  expectedBytes: number | null;
  responseState: SourceResponseState;
};

export interface SourceCatalog {
  discover(productIdentifier: string): Promise<DiscoveredProduct>;
  download(downloadUrl: string): Promise<ArtifactDownload>;
}

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly responseState: SourceResponseState,
  ) {
    super(message);
    this.name = "SourceHttpError";
  }
}

export class SourceTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTransportError";
  }
}

export class SourceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceContractError";
  }
}
