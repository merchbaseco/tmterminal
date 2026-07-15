import { createHash } from "node:crypto";

export function retainedVersionFingerprint(sha256s: string[]) {
  return createHash("sha256").update(JSON.stringify([...sha256s].sort())).digest("hex");
}
