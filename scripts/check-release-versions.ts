import { readFileSync } from "node:fs";

interface PackageJson {
  version?: string;
}

const readPackageJson = (relativePath: string) =>
  JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8")) as PackageJson;

const requireVersion = (name: string, version: string | undefined) => {
  if (!version) {
    throw new Error(`${name} is missing a version.`);
  }

  return version;
};

const cliVersion = requireVersion(
  "@tmterminal/cli",
  readPackageJson("packages/cli/package.json").version
);
const httpClientVersion = requireVersion(
  "@tmterminal/http-client",
  readPackageJson("packages/http-client/package.json").version
);

if (cliVersion !== httpClientVersion) {
  throw new Error(
    `Release versions are out of sync: CLI ${cliVersion}, HTTP client ${httpClientVersion}.`
  );
}

const changelog = readFileSync(new URL("../packages/cli/CHANGELOG.md", import.meta.url), "utf8");
const firstRelease = changelog.match(/^## v([^ ]+) - \d{4}-\d{2}-\d{2}$/m)?.[1];

if (firstRelease !== cliVersion) {
  throw new Error(
    `Changelog release ${firstRelease ?? "missing"} does not match package version ${cliVersion}.`
  );
}

console.log(`Release versions are synchronized at ${cliVersion}.`);
