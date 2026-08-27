import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const releasedVersion = readFileSync(join(import.meta.dir, "../../../VERSION"), "utf8").trim();

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}

const { cleanup, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { legalDisclaimer, LegalFooter } = await import("../src/legal-footer.tsx");
const { productVersion } = await import("../src/product-version.ts");

afterEach(() => {
  cleanup();
});

test("shows the disclaimer and the released product version", () => {
  render(<LegalFooter />);

  expect(screen.getByText(legalDisclaimer)).toBeTruthy();
  expect(screen.getByText(`v${releasedVersion}`)).toBeTruthy();
  expect(productVersion).toBe(releasedVersion);
});
