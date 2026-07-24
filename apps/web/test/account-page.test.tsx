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
      delete: async (id) => ({ id }),
      list: async () => [],
      revoke: async () => ({ ...key, status: "revoked" }),
    };

    render(<AccountPage api={api} />);
    expect(screen.getByRole("heading", { level: 1, name: "ACCESS CONTROL" })).toBeTruthy();
    expect(screen.queryByText("zach@example.com")).toBeNull();
    await screen.findByText("No active keys. Create one when a service needs access.");
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "MerchBase" },
    });
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
      delete: async (id) => ({ id }),
      list: async () => [],
      revoke: async () => ({ ...key, status: "revoked" }),
    };

    render(<AccountPage api={api} />);
    await screen.findByText("No active keys. Create one when a service needs access.");
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "MerchBase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect((await screen.findByTestId("issued-token")).textContent).toBe(token);
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "I saved this key" }));
    await waitFor(() => expect(screen.queryByText(token)).toBeNull());
    expect(screen.getByText("••••AAAAAA")).toBeTruthy();
  });

  test("confirms revocation and moves the key into account history", async () => {
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      status: "active" as const,
      suffix: "AAAAAA",
    };
    const revokedIds: string[] = [];
    const api: AccountApi = {
      create: async () => ({ key, token: "unused" }),
      delete: async (id) => ({ id }),
      list: async () => [key],
      revoke: (id) => {
        revokedIds.push(id);
        return Promise.resolve({ ...key, status: "revoked" });
      },
    };

    render(<AccountPage api={api} />);
    const revoke = await screen.findByRole("button", { name: "Revoke MerchBase" });

    fireEvent.click(revoke);
    expect(screen.getByRole("dialog", { name: "Revoke API key?" })).toBeTruthy();
    expect(
      screen.getByText("“MerchBase” will stop working immediately. This cannot be undone.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));

    await screen.findByText("Revoked history");
    expect(revokedIds).toEqual([key.id]);
    expect(screen.queryByRole("button", { name: "Revoke MerchBase" })).toBeNull();
  });

  test("deletes a revoked key from account history", async () => {
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      status: "revoked" as const,
      suffix: "AAAAAA",
    };
    const deletedIds: string[] = [];
    const api: AccountApi = {
      create: async () => ({ key: { ...key, status: "active" }, token: "unused" }),
      delete: (id) => {
        deletedIds.push(id);
        return Promise.resolve({ id });
      },
      list: async () => [key],
      revoke: async () => key,
    };

    render(<AccountPage api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete MerchBase" }));
    expect(screen.getByRole("dialog", { name: "Delete API key?" })).toBeTruthy();
    expect(
      screen.getByText(
        "“MerchBase” will be permanently removed from account history. This cannot be undone."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete key" }));

    await waitFor(() => expect(screen.queryByText("Revoked history")).toBeNull());
    expect(deletedIds).toEqual([key.id]);
  });
});
