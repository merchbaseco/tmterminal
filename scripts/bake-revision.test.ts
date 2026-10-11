import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertBakeRevision, bakeRevision, renderBuildRevisionModule } from "./bake-revision.ts";

const fortyCharSha = "ab".repeat(20);
const expectedShaModule = `export const buildRevision: string = "${fortyCharSha}";\n`;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempOutputPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bake-revision-"));
  tempDirs.push(dir);
  return join(dir, "build-revision.ts");
}

test("renderBuildRevisionModule accepts a 40-character git SHA", () => {
  expect(renderBuildRevisionModule(fortyCharSha)).toBe(expectedShaModule);
});

test("bakeRevision writes the rendered module for a git SHA", async () => {
  const outputPath = await tempOutputPath();
  await bakeRevision(fortyCharSha, outputPath);
  expect(await readFile(outputPath, "utf8")).toBe(expectedShaModule);
});

test("renderBuildRevisionModule accepts a workstation development revision", () => {
  expect(renderBuildRevisionModule("development")).toBe(
    'export const buildRevision: string = "development";\n'
  );
  expect(renderBuildRevisionModule("development-tmterminal-4100")).toBe(
    'export const buildRevision: string = "development-tmterminal-4100";\n'
  );
});

test("assertBakeRevision rejects a source placeholder and a malformed token", () => {
  expect(() => assertBakeRevision("dev")).toThrow('invalid bake revision: "dev"');
  expect(() => assertBakeRevision("")).toThrow('invalid bake revision: ""');
  expect(() => assertBakeRevision("AB".repeat(20))).toThrow(
    'invalid bake revision: "ABABABABABABABABABABABABABABABABABABABAB"'
  );
  expect(() => assertBakeRevision("development-")).toThrow('invalid bake revision: "development-"');
});

test("bakeRevision does not write the output file when validation fails", async () => {
  const outputPath = await tempOutputPath();
  await expect(bakeRevision("dev", outputPath)).rejects.toThrow();
  await expect(stat(outputPath)).rejects.toThrow();
});
