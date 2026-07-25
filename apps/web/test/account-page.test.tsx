import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
Element.prototype.getAnimations ??= () => [];

const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { afterEach, describe, expect, test, vi } = await import("bun:test");
const { AccountPage } = await import("../src/account-page.tsx");
const { AccountPreferenceSaveStatus } = await import("../src/account-preference-save-status.tsx");
const { defaultSearchPreferences } = await import("../src/search-preferences.ts");
type AccountApi = import("../src/account-page.tsx").AccountApi;
type SearchPreferences = import("../src/search-preferences.ts").SearchPreferences;

function unchangedPreferences(preferences: SearchPreferences) {
  return Promise.resolve(preferences);
}

function rejectPreferences() {
  return Promise.reject(new Error("offline"));
}

function renderAccount(api: AccountApi) {
  return render(
    <AccountPage
      api={api}
      onUpdatePreferences={unchangedPreferences}
      preferences={defaultSearchPreferences}
      preferencesError={null}
      preferencesLoading={false}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
});

describe("account page", () => {
  test("save feedback uses one visual status layer", () => {
    const { container, rerender } = render(
      <AccountPreferenceSaveStatus error={null} saved={false} saving />
    );

    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);

    rerender(<AccountPreferenceSaveStatus error={null} saved saving={false} />);

    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
  });

  test("keeps preference controls inert when stored preferences fail to load", async () => {
    const api: AccountApi = {
      create: () => Promise.reject(new Error("not used")),
      list: async () => [],
      revoke: () => Promise.reject(new Error("not used")),
    };

    render(
      <AccountPage
        api={api}
        onUpdatePreferences={unchangedPreferences}
        preferences={defaultSearchPreferences}
        preferencesError="Search preferences could not be loaded."
        preferencesLoading={false}
      />
    );

    expect(
      (screen.getByRole("button", { name: "Default match: Exact + partial" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await screen.findByText("No API keys yet");
  });

  test("saves search preferences from the account settings list", async () => {
    const api: AccountApi = {
      create: () => Promise.reject(new Error("not used")),
      list: async () => [],
      revoke: () => Promise.reject(new Error("not used")),
    };
    const updates: SearchPreferences[] = [];
    let resolveUpdate: ((preferences: SearchPreferences) => void) | undefined;
    const updatePreferences = (preferences: SearchPreferences) => {
      updates.push(preferences);
      return new Promise<SearchPreferences>((resolve) => {
        resolveUpdate = resolve;
      });
    };

    render(
      <AccountPage
        api={api}
        onUpdatePreferences={updatePreferences}
        preferences={defaultSearchPreferences}
        preferencesError={null}
        preferencesLoading={false}
      />
    );

    expect(screen.queryByText("Saved automatically")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Default status: All" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Live" }));

    await waitFor(() => expect(updates).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Saving search preferences")
    );
    expect(updates[0]).toEqual({ ...defaultSearchPreferences, defaultStatus: "live" });
    vi.useFakeTimers();
    await act(async () => {
      resolveUpdate?.(updates[0] as SearchPreferences);
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toBe("Search preferences saved");
    expect(screen.getByRole("button", { name: "Default status: Live" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test("shows a save failure without claiming success", async () => {
    const api: AccountApi = {
      create: () => Promise.reject(new Error("not used")),
      list: async () => [],
      revoke: () => Promise.reject(new Error("not used")),
    };

    render(
      <AccountPage
        api={api}
        onUpdatePreferences={rejectPreferences}
        preferences={defaultSearchPreferences}
        preferencesError={null}
        preferencesLoading={false}
      />
    );

    await screen.findByText("No API keys yet");
    fireEvent.click(screen.getByRole("button", { name: "Default status: All" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Live" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Search preferences could not be saved. Try again."
    );
    expect(screen.getByRole("button", { name: "Default status: All" })).toBeTruthy();
    expect(screen.queryByText("Saved automatically")).toBeNull();
  });

  test("keeps the dialog open until a pending key creation reveals the token", async () => {
    const token =
      "ttk_11111111-1111-4111-8111-111111111111_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      suffix: "AAAAAA",
    };
    let resolveCreate: ((created: { key: typeof key; token: string }) => void) | undefined;
    const api: AccountApi = {
      create: () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
      list: async () => [],
      revoke: async (id) => ({ id }),
    };

    renderAccount(api);
    expect(screen.getByRole("heading", { level: 1, name: "ACCOUNT" })).toBeTruthy();
    expect(screen.getByText("Used this month")).toBeTruthy();
    expect(screen.getByText("Monthly allowance")).toBeTruthy();
    expect(screen.queryByText("zach@example.com")).toBeNull();
    await screen.findByText("No API keys yet");
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
      suffix: "AAAAAA",
    };
    const api: AccountApi = {
      create: async () => ({ key, token }),
      list: async () => [],
      revoke: async (id) => ({ id }),
    };

    renderAccount(api);
    await screen.findByText("No API keys yet");
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

  test("confirms revocation and removes the key", async () => {
    const key = {
      createdAt: "2026-07-14T12:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      lastUsedAt: null,
      name: "MerchBase",
      suffix: "AAAAAA",
    };
    const revokedIds: string[] = [];
    const api: AccountApi = {
      create: async () => ({ key, token: "unused" }),
      list: async () => [key],
      revoke: (id) => {
        revokedIds.push(id);
        return Promise.resolve({ id });
      },
    };

    renderAccount(api);
    const revoke = await screen.findByRole("button", { name: "Revoke MerchBase" });

    fireEvent.click(revoke);
    expect(screen.getByRole("dialog", { name: "Revoke API key?" })).toBeTruthy();
    expect(
      screen.getByText(
        "“MerchBase” will stop working immediately and disappear from this account. This cannot be undone."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));

    await screen.findByText("No API keys yet");
    expect(revokedIds).toEqual([key.id]);
    expect(screen.queryByRole("button", { name: "Revoke MerchBase" })).toBeNull();
  });
});
