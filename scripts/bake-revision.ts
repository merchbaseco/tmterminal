const shaPattern = /^[0-9a-f]{40}$/;
const developmentPattern = /^development(-[a-z0-9-]+)?$/;

export function assertBakeRevision(revision: string): string {
  if (shaPattern.test(revision) || developmentPattern.test(revision)) {
    return revision;
  }
  throw new Error(`invalid bake revision: ${JSON.stringify(revision)}`);
}

export function renderBuildRevisionModule(revision: string): string {
  const accepted = assertBakeRevision(revision);
  return `export const buildRevision: string = ${JSON.stringify(accepted)};\n`;
}

export async function bakeRevision(revision: string, outputPath: string): Promise<void> {
  const contents = renderBuildRevisionModule(revision);
  await Bun.write(outputPath, contents);
}

if (import.meta.main) {
  const [, , revision, outputPath] = process.argv;
  if (!(revision && outputPath)) {
    throw new Error("usage: bake-revision.ts <revision> <output-path>");
  }
  await bakeRevision(revision, outputPath);
}
