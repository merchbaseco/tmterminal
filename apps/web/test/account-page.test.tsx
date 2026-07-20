import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, describe, expect, test } = await import("bun:test");
const { AccountPage } = await import("../src/account-page.tsx");
type AccountApi = import("../src/account-page.tsx").AccountApi;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("account page", () => {
  test("keeps the dialog open until a pending key creation reveals the token", async () => {
    const token =
      "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      status: "active" as const,
      suffix: "AAAAAA",
    };
    let resolveCreate: ((created: { key: typeof key; token: string }) => void) | undefined;
    const api: AccountApi = {
      create: () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
      list: async () => [],
      revoke: async () => ({ ...key, status: "revoked" }),
    };

    render(<AccountPage api={api} email="zach@example.com" />);
    expect(screen.getByRole("heading", { level: 1, name: "ACCOUNT" })).toBeTruthy();
    expect(screen.getByText("zach@example.com")).toBeTruthy();
    await screen.findByText("No API keys yet.");
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MerchBase" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog")).toBeTruthy();
    resolveCreate?.({ key, token });
    expect((await screen.findByTestId("issued-token")).textContent).toBe(token);
  });

  test("shows a new raw token once and removes it after acknowledgement", async () => {
    const token =
      "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      status: "active" as const,
      suffix: "AAAAAA",
    };
    const api: AccountApi = {
      create: async () => ({ key, token }),
      list: async () => [],
      revoke: async () => ({ ...key, status: "revoked" }),
    };

    render(<AccountPage api={api} email="zach@example.com" />);
    await screen.findByText("No API keys yet.");
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MerchBase" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect((await screen.findByTestId("issued-token")).textContent).toBe(token);
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "I saved this key" }));
    await waitFor(() => expect(screen.queryByText(token)).toBeNull());
    expect(screen.getByText("••••AAAAAA")).toBeTruthy();
  });
});
