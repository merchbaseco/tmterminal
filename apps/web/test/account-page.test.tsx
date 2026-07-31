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
type SearchPreferences = import("../src/search-preferences.ts").SearchPreferences;

function unchangedPreferences(preferences: SearchPreferences) {
  return Promise.resolve(preferences);
}

function renderAccount(
  overrides: {
    onUpdatePreferences?: (preferences: SearchPreferences) => Promise<SearchPreferences>;
    preferencesError?: string | null;
  } = {}
) {
  return render(
    <AccountPage
      onUpdatePreferences={overrides.onUpdatePreferences ?? unchangedPreferences}
      preferences={defaultSearchPreferences}
      preferencesError={overrides.preferencesError ?? null}
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
  test("links suite-wide key management to the Merchbase Account Center", () => {
    renderAccount();

    const link = screen.getByRole("link", { name: "Manage API keys" });
    expect(link.getAttribute("href")).toBe("https://merchbase.co/account/api-keys/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText("One key for every Merchbase service")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
  });

  test("save feedback uses one visual status layer", () => {
    const { container, rerender } = render(
      <AccountPreferenceSaveStatus error={null} saved={false} saving />
    );

    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
    rerender(<AccountPreferenceSaveStatus error={null} saved saving={false} />);
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
  });

  test("keeps preference controls inert when stored preferences fail to load", () => {
    renderAccount({ preferencesError: "Search preferences could not be loaded." });

    expect(
      (
        screen.getByRole("button", {
          name: "Default match: Exact + partial",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByRole("link", { name: "Manage API keys" })).toBeTruthy();
  });

  test("saves search preferences from the account settings list", async () => {
    const updates: SearchPreferences[] = [];
    let resolveUpdate: ((preferences: SearchPreferences) => void) | undefined;
    const updatePreferences = (preferences: SearchPreferences) => {
      updates.push(preferences);
      return new Promise<SearchPreferences>((resolve) => {
        resolveUpdate = resolve;
      });
    };

    renderAccount({ onUpdatePreferences: updatePreferences });
    fireEvent.click(screen.getByRole("button", { name: "Default status: All" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Live" }));

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(screen.getByRole("status").textContent).toBe("Saving search preferences");
    vi.useFakeTimers();
    await act(async () => {
      resolveUpdate?.(updates[0] as SearchPreferences);
      await Promise.resolve();
    });
    expect(screen.getByRole("status").textContent).toBe("Search preferences saved");
    expect(screen.getByRole("button", { name: "Default status: Live" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  test("shows a save failure without claiming success", async () => {
    renderAccount({
      onUpdatePreferences: () => Promise.reject(new Error("offline")),
    });

    fireEvent.click(screen.getByRole("button", { name: "Default status: All" }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Live" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Search preferences could not be saved. Try again."
    );
    expect(screen.getByRole("button", { name: "Default status: All" })).toBeTruthy();
  });
});
