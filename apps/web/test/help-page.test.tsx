import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { cleanup, render, screen } = await import("@testing-library/react");
const { afterEach, expect, test } = await import("bun:test");
const { HelpPage } = await import("../src/help-page.tsx");
const class025Copy = /International Class 025/;

afterEach(() => {
  cleanup();
});

test("explains website tools, status, keys, and automation", () => {
  render(<HelpPage />);

  expect(screen.getByRole("heading", { name: "SEARCH SMARTER" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Search Marks" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Check Text" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Bulk Check" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Mark records" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Status" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Account and API keys" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Automation" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "MerchBase Account Center" }).getAttribute("href")).toBe(
    "https://merchbase.co/account/api-keys/"
  );
  expect(screen.getByText(class025Copy)).toBeTruthy();
});
