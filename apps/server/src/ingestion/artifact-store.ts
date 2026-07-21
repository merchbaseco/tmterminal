export interface StoredArtifact {
  bytes: number;
  objectKey: string;
  sha256: string;
}

export interface ArtifactStore {
  listObjectKeys: () => AsyncIterable<string>;
  openFile: (objectKey: string) => Promise<string>;
  put: (
    body: ReadableStream<Uint8Array>,
    expectedBytes: number | null,
    reservationKey: string
  ) => Promise<StoredArtifact>;
  recoverPut: (reservationKey: string, expectedBytes: number) => Promise<StoredArtifact | null>;
  remove: (objectKey: string) => Promise<void>;
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}
