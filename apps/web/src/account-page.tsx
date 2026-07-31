import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AccountPreferenceSaveStatus } from "./account-preference-save-status.tsx";
import { AccountPreferenceSelect } from "./account-preference-select.tsx";
import { LegalFooter } from "./legal-footer.tsx";
import { PageMasthead } from "./page-masthead.tsx";
import type { SearchPreferences } from "./search-preferences.ts";

const apiKeysUrl = "https://merchbase.co/account/api-keys/";
const densityOptions = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
] as const;
const matchOptions = [
  { label: "Exact + partial", value: "both" },
  { label: "Exact only", value: "exact" },
  { label: "Partial only", value: "partial" },
] as const;
const pageSizeOptions = [
  { label: "25 results", value: "25" },
  { label: "50 results", value: "50" },
  { label: "100 results", value: "100" },
] as const;
const registeredOptions = [
  { label: "All", value: "all" },
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
] as const;
const sortOptions = [
  { label: "Relevance", value: "relevance" },
  { label: "Newest activity", value: "newest-activity" },
  { label: "Oldest activity", value: "oldest-activity" },
] as const;
const statusOptions = [
  { label: "All", value: "all" },
  { label: "Live", value: "live" },
  { label: "Dead", value: "dead" },
] as const;
const typeOptions = [
  { label: "All", value: "all" },
  { label: "Design", value: "design" },
  { label: "Typeset", value: "typeset" },
  { label: "Text", value: "text" },
] as const;

export interface AccountPreferencesApi {
  getPreferences: () => Promise<SearchPreferences>;
  updatePreferences: (preferences: SearchPreferences) => Promise<SearchPreferences>;
}

export function AccountPage({
  onUpdatePreferences,
  preferences,
  preferencesError,
  preferencesLoading,
}: {
  onUpdatePreferences: (preferences: SearchPreferences) => Promise<SearchPreferences>;
  preferences: SearchPreferences;
  preferencesError: string | null;
  preferencesLoading: boolean;
}) {
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);
  const [preferencesSaveError, setPreferencesSaveError] = useState<string | null>(null);

  useEffect(() => setDraftPreferences(preferences), [preferences]);
  useEffect(() => {
    if (!preferencesSaved) {
      return;
    }
    const timeout = window.setTimeout(() => setPreferencesSaved(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [preferencesSaved]);

  const savePreferences = useCallback(
    async (nextPreferences: SearchPreferences) => {
      setDraftPreferences(nextPreferences);
      setPreferencesSaving(true);
      setPreferencesSaved(false);
      setPreferencesSaveError(null);
      try {
        const saved = await onUpdatePreferences(nextPreferences);
        setDraftPreferences(saved);
        setPreferencesSaved(true);
      } catch {
        setDraftPreferences(preferences);
        setPreferencesSaved(false);
        setPreferencesSaveError("Search preferences could not be saved. Try again.");
      } finally {
        setPreferencesSaving(false);
      }
    },
    [onUpdatePreferences, preferences]
  );

  const changeDefaultMatch = useCallback(
    (defaultMatch: SearchPreferences["defaultMatch"]) => {
      savePreferences({ ...draftPreferences, defaultMatch });
    },
    [draftPreferences, savePreferences]
  );
  const changeDefaultStatus = useCallback(
    (defaultStatus: SearchPreferences["defaultStatus"]) => {
      savePreferences({ ...draftPreferences, defaultStatus });
    },
    [draftPreferences, savePreferences]
  );
  const changeDefaultType = useCallback(
    (defaultType: SearchPreferences["defaultType"]) => {
      savePreferences({ ...draftPreferences, defaultType });
    },
    [draftPreferences, savePreferences]
  );
  const changeDefaultRegistered = useCallback(
    (defaultRegistered: SearchPreferences["defaultRegistered"]) => {
      savePreferences({ ...draftPreferences, defaultRegistered });
    },
    [draftPreferences, savePreferences]
  );
  const changeDefaultSort = useCallback(
    (defaultSort: SearchPreferences["defaultSort"]) => {
      savePreferences({ ...draftPreferences, defaultSort });
    },
    [draftPreferences, savePreferences]
  );
  const changePageSize = useCallback(
    (value: "25" | "50" | "100") => {
      let pageSize: SearchPreferences["pageSize"] = 25;
      if (value === "50") {
        pageSize = 50;
      } else if (value === "100") {
        pageSize = 100;
      }
      savePreferences({ ...draftPreferences, pageSize });
    },
    [draftPreferences, savePreferences]
  );
  const changeResultDensity = useCallback(
    (resultDensity: SearchPreferences["resultDensity"]) => {
      savePreferences({ ...draftPreferences, resultDensity });
    },
    [draftPreferences, savePreferences]
  );

  const preferenceControlsDisabled =
    preferencesLoading || preferencesSaving || Boolean(preferencesError);

  return (
    <main className="page-shell page-start isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col pb-[clamp(2rem,5vw,5.5rem)]">
      <PageMasthead
        description="Manage your Trademark Terminal settings and API access. Your account is tied to your MerchBase.co account."
        title="ACCOUNT"
      />

      <section
        aria-label="Account access"
        className="mt-[clamp(2.5rem,5vw,4.5rem)] border border-border"
      >
        <div className="flex min-h-11 items-center border-border border-b bg-muted/40 px-4 py-1.5">
          <h2 className="utility-label m-0 text-muted-foreground">Merchbase API keys</h2>
        </div>
        <div className="grid items-center gap-5 p-4 min-[48rem]:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1">
            <p className="m-0 font-semibold text-base">One key for every Merchbase service</p>
            <p className="m-0 max-w-[62ch] text-pretty text-base text-muted-foreground">
              Create, inspect, and retire suite-wide API keys in your Merchbase Account Center.
            </p>
          </div>
          <Button
            className="pill-button max-[48rem]:w-full"
            render={<a href={apiKeysUrl} rel="noreferrer" target="_blank" />}
          >
            Manage API keys
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="search-preferences-title"
        className="mt-[clamp(3.5rem,7vw,7rem)] grid gap-5"
      >
        <div className="flex min-w-0 items-end justify-between gap-6 max-[48rem]:grid">
          <div className="grid min-w-0 gap-1">
            <h2 className="section-title m-0 text-balance" id="search-preferences-title">
              Search preferences
            </h2>
            <p className="m-0 max-w-[64ch] text-pretty text-base text-muted-foreground">
              Choose how a new search starts. Shared search links keep their own options.
            </p>
          </div>
          <AccountPreferenceSaveStatus
            error={preferencesSaveError ?? preferencesError}
            saved={preferencesSaved}
            saving={preferencesSaving}
          />
        </div>
        <fieldset
          aria-busy={preferencesLoading || preferencesSaving}
          className="m-0 grid min-w-0 border border-border border-b-0 p-0 [--settings-control-column:clamp(11rem,22vw,18rem)] [&>div]:border-border [&>div]:border-b"
          disabled={preferenceControlsDisabled}
        >
          <legend className="sr-only">Search defaults</legend>
          <div className="flex min-h-11 items-center bg-muted/40 px-4">
            <h3 className="utility-label m-0 text-muted-foreground">Matching</h3>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Default match</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                Exact, partial, or both.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Default match"
                name="default-match"
                onValueChange={changeDefaultMatch}
                options={matchOptions}
                value={draftPreferences.defaultMatch}
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Default status</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                All, live, or dead marks.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Default status"
                name="default-status"
                onValueChange={changeDefaultStatus}
                options={statusOptions}
                value={draftPreferences.defaultStatus}
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Default type</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                Design, typeset, or text marks.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Default type"
                name="default-type"
                onValueChange={changeDefaultType}
                options={typeOptions}
                value={draftPreferences.defaultType}
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Default registration</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                All, registered, or unregistered marks.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Default registration"
                name="default-registered"
                onValueChange={changeDefaultRegistered}
                options={registeredOptions}
                value={draftPreferences.defaultRegistered}
              />
            </div>
          </div>
          <div className="flex min-h-11 items-center bg-muted/40 px-4">
            <h3 className="utility-label m-0 text-muted-foreground">Results</h3>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Default sort</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                Initial order of new result lists.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Default sort"
                name="default-sort"
                onValueChange={changeDefaultSort}
                options={sortOptions}
                value={draftPreferences.defaultSort}
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Results per load</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                How many marks load at a time.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Results per load"
                name="page-size"
                onValueChange={changePageSize}
                options={pageSizeOptions}
                value={String(draftPreferences.pageSize) as "25" | "50" | "100"}
              />
            </div>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--settings-control-column)] items-stretch max-[40rem]:grid-cols-1">
            <div className="grid min-w-0 content-center gap-1 px-4 py-4">
              <h4 className="m-0 font-medium text-base text-foreground">Result density</h4>
              <p className="m-0 max-w-[58ch] text-pretty text-base text-muted-foreground">
                Tighter rows or more breathing room.
              </p>
            </div>
            <div className="min-w-0 border-border border-l max-[40rem]:border-t max-[40rem]:border-l-0">
              <AccountPreferenceSelect
                disabled={preferenceControlsDisabled}
                label="Result density"
                name="result-density"
                onValueChange={changeResultDensity}
                options={densityOptions}
                value={draftPreferences.resultDensity}
              />
            </div>
          </div>
        </fieldset>
      </section>

      <LegalFooter />
    </main>
  );
}
