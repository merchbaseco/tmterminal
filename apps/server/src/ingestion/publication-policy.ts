import { annualGenerationV1Artifacts } from "./annual-generation-v1.ts";

const annualGenerationArtifacts = new Set<string>(annualGenerationV1Artifacts);

export function isPublicationPolicyArtifact(artifact: {
  filename: string;
  product: string;
  sourceFromDate: string;
  sourceToDate: string;
}) {
  return (
    artifact.product === "TRTYRAP" &&
    artifact.sourceFromDate === "1884-04-07" &&
    artifact.sourceToDate === "2025-12-31" &&
    annualGenerationArtifacts.has(artifact.filename)
  );
}

export function isPublicationPolicyDiscovery(discovery: { filename: string; product: string }) {
  return discovery.product === "TRTYRAP" && annualGenerationArtifacts.has(discovery.filename);
}

export function annualGenerationArtifactCount() {
  return annualGenerationArtifacts.size;
}
