export interface StoredArtifact {
  bytes: number;
  objectKey: string;
  sha256: string;
}

export interface ArtifactStore {
  get: (objectKey: string) => Promise<ReadableStream<Uint8Array>>;
  head: (objectKey: string) => Promise<{ bytes: number } | null>;
  listObjectKeys: () => AsyncIterable<string>;
  put: (body: ReadableStream<Uint8Array>, expectedBytes: number | null) => Promise<StoredArtifact>;
  remove: (objectKey: string) => Promise<void>;
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}
