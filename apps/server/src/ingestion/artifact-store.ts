export interface StoredArtifact {
  bytes: number;
  objectKey: string;
  sha256: string;
}

export interface ArtifactStore {
  head: (objectKey: string) => Promise<{ bytes: number } | null>;
  listObjectKeys: () => AsyncIterable<string>;
  openFile: (objectKey: string) => Promise<string>;
  put: (body: ReadableStream<Uint8Array>, expectedBytes: number | null) => Promise<StoredArtifact>;
  remove: (objectKey: string) => Promise<void>;
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}
