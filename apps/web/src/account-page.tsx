import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Delete02Icon } from "@hugeicons-pro/core-stroke-rounded";
import type { inferRouterOutputs } from "@trpc/server";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { AppRouter } from "../../server/src/api/router.ts";
import { AccountPreferenceSaveStatus } from "./account-preference-save-status.tsx";
import { AccountPreferenceSelect } from "./account-preference-select.tsx";
import { LegalFooter } from "./legal-footer.tsx";
import { PageMasthead } from "./page-masthead.tsx";
import type { SearchPreferences } from "./search-preferences.ts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ApiKey = RouterOutputs["account"]["api-keys"]["list"][number];
type CreatedApiKey = RouterOutputs["account"]["api-keys"]["create"];
const placeholderApiUsage = {
  monthlyAllowance: 10_000,
  usedThisMonth: 0,
};
const countFormatter = new Intl.NumberFormat("en-US");
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

export interface AccountApi {
  create: (name: string) => Promise<CreatedApiKey>;
  list: () => Promise<ApiKey[]>;
  revoke: (id: string) => Promise<{ id: string }>;
}

export interface AccountPreferencesApi {
  getPreferences: () => Promise<SearchPreferences>;
  updatePreferences: (preferences: SearchPreferences) => Promise<SearchPreferences>;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function describeKeyAction(key: ApiKey | null) {
  if (!key) {
    return "";
  }
  return `“${key.name}” will stop working immediately and disappear from this account. This cannot be undone.`;
}

function ApiKeyRow({
  keyRecord,
  onRevoke,
}: {
  keyRecord: ApiKey;
  onRevoke: (key: ApiKey) => void;
}) {
  const revoke = useCallback(() => {
    onRevoke(keyRecord);
  }, [keyRecord, onRevoke]);

  return (
    <article className="relative min-h-20 border-border border-b">
      <dl className="m-0 grid min-h-20 min-w-0 grid-cols-2 pr-20 pl-4 min-[48rem]:grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)]">
        <div className="grid min-w-0 content-center gap-1 py-4 max-[48rem]:col-span-2 min-[48rem]:py-3 min-[48rem]:pr-5">
          <dt className="utility-label text-muted-foreground">Name</dt>
          <dd className="m-0 truncate font-semibold text-base">{keyRecord.name}</dd>
        </div>
        <div className="grid min-w-0 content-center gap-1 border-border border-t py-4 pr-5 min-[48rem]:border-t-0 min-[48rem]:border-l min-[48rem]:px-5 min-[48rem]:py-3">
          <dt className="utility-label text-muted-foreground">Key</dt>
          <dd className="m-0 text-base text-muted-foreground tabular-nums">
            ••••{keyRecord.suffix}
          </dd>
        </div>
        <div className="grid min-w-0 content-center gap-1 border-border border-t border-l py-4 pl-5 min-[48rem]:border-t-0 min-[48rem]:px-5 min-[48rem]:py-3">
          <dt className="utility-label text-muted-foreground">Created</dt>
          <dd className="m-0 text-base text-muted-foreground tabular-nums">
            {formatDate(keyRecord.createdAt)}
          </dd>
        </div>
        <div className="col-span-2 grid min-w-0 content-center gap-1 border-border border-t py-4 min-[48rem]:col-span-1 min-[48rem]:border-t-0 min-[48rem]:border-l min-[48rem]:py-3 min-[48rem]:pl-5">
          <dt className="utility-label text-muted-foreground">Last used</dt>
          <dd className="m-0 text-base text-muted-foreground tabular-nums">
            {keyRecord.lastUsedAt ? formatDate(keyRecord.lastUsedAt) : "Never"}
          </dd>
        </div>
      </dl>
      <Button
        aria-label={`Revoke ${keyRecord.name}`}
        className="pill-button absolute top-1/2 right-4 -translate-y-1/2"
        onClick={revoke}
        size="icon"
        variant="destructive-outline"
      >
        <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
      </Button>
    </article>
  );
}

export function AccountPage({
  api,
  onUpdatePreferences,
  preferences,
  preferencesError,
  preferencesLoading,
}: {
  api: AccountApi;
  onUpdatePreferences: (preferences: SearchPreferences) => Promise<SearchPreferences>;
  preferences: SearchPreferences;
  preferencesError: string | null;
  preferencesLoading: boolean;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [keyAction, setKeyAction] = useState<ApiKey | null>(null);
  const [keyActionPending, setKeyActionPending] = useState(false);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    api
      .list()
      .then((listed) => {
        if (active) {
          setKeys(listed);
        }
      })
      .catch(() => {
        if (active) {
          setError("API keys could not be loaded.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api]);

  const createKey = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setCreating(true);
      setError(null);
      try {
        const created = await api.create(name);
        setKeys((current) => [created.key, ...current]);
        setIssuedToken(created.token);
        setName("");
      } catch {
        setError("API key could not be created.");
      } finally {
        setCreating(false);
      }
    },
    [api, name]
  );

  const confirmKeyAction = useCallback(async () => {
    if (!keyAction) {
      return;
    }
    setKeyActionPending(true);
    setKeyActionError(null);
    try {
      const revoked = await api.revoke(keyAction.id);
      setKeys((current) => current.filter((key) => key.id !== revoked.id));
      setKeyAction(null);
    } catch {
      setKeyActionError("API key could not be revoked. Try again.");
    } finally {
      setKeyActionPending(false);
    }
  }, [api, keyAction]);

  const openRevoke = useCallback((key: ApiKey) => {
    setKeyActionError(null);
    setKeyAction(key);
  }, []);

  const changeKeyActionOpen = useCallback(
    (open: boolean) => {
      if (!(open || keyActionPending)) {
        setKeyActionError(null);
        setKeyAction(null);
      }
    },
    [keyActionPending]
  );

  const cancelKeyAction = useCallback(() => {
    if (!keyActionPending) {
      setKeyActionError(null);
      setKeyAction(null);
    }
  }, [keyActionPending]);

  const acknowledgeToken = useCallback(() => {
    setIssuedToken(null);
    setCreateOpen(false);
  }, []);

  const changeName = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const copyIssuedToken = useCallback(() => {
    if (issuedToken) {
      navigator.clipboard
        .writeText(issuedToken)
        .catch(() => setError("API key could not be copied."));
    }
  }, [issuedToken]);

  const changeCreateOpen = useCallback(
    (open: boolean) => {
      if (!(issuedToken || creating)) {
        setCreateOpen(open);
      }
    },
    [creating, issuedToken]
  );

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
        description="Manage your Trademark Turtle settings and API access. Your account is tied to your MerchBase.co account."
        title="ACCOUNT"
      />

      <section
        aria-label="Account access"
        className="mt-[clamp(2.5rem,5vw,4.5rem)] grid gap-[clamp(1.5rem,2vw,2rem)]"
      >
        <div className="grid items-end gap-6 min-[48rem]:grid-cols-[minmax(0,1fr)_auto] min-[48rem]:gap-8">
          <div className="@container min-w-0">
            <dl className="m-0 grid max-w-[34rem] @max-[20rem]:grid-cols-1 grid-cols-2 @max-[20rem]:gap-4">
              <div className="grid min-w-0 content-start gap-1 pr-6">
                <dt className="truncate font-medium text-base text-muted-foreground">
                  Used this month
                </dt>
                <dd className="m-0 font-semibold text-2xl tabular-nums tracking-tight">
                  {countFormatter.format(placeholderApiUsage.usedThisMonth)}
                </dd>
              </div>
              <div className="grid min-w-0 content-start gap-1 border-border @max-[20rem]:border-t border-l @max-[20rem]:border-l-0 @max-[20rem]:pt-4 @max-[20rem]:pl-0 pl-6">
                <dt className="truncate font-medium text-base text-muted-foreground">
                  Monthly allowance
                </dt>
                <dd className="m-0 font-semibold text-2xl tabular-nums tracking-tight">
                  {countFormatter.format(placeholderApiUsage.monthlyAllowance)}
                </dd>
              </div>
            </dl>
          </div>
          <Dialog onOpenChange={changeCreateOpen} open={createOpen}>
            <DialogTrigger
              render={<Button className="pill-button text-base max-[48rem]:w-full sm:text-base" />}
            >
              Create API key
            </DialogTrigger>
            <DialogPopup
              className="max-w-lg rounded-xl border-border bg-popover shadow-none before:hidden sm:data-ending-style:translate-y-2 sm:data-starting-style:translate-y-2 sm:data-ending-style:scale-100 sm:data-starting-style:scale-100"
              closeProps={{ className: "absolute end-4 top-4 rounded-full" }}
              showCloseButton={!(issuedToken || creating)}
            >
              {issuedToken ? (
                <>
                  <DialogHeader className="gap-2 p-6 pr-16 pb-4">
                    <DialogTitle className="section-title text-balance">
                      Save your API key
                    </DialogTitle>
                    <DialogDescription className="max-w-[42ch] text-pretty text-base">
                      Copy this key now. You will not be able to see it again.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogPanel className="px-6 pt-0 pb-6">
                    <div className="border-border/70 border-y py-4">
                      <code
                        className="wrap-anywhere block select-all font-sans tabular-nums"
                        data-testid="issued-token"
                      >
                        {issuedToken}
                      </code>
                    </div>
                  </DialogPanel>
                  <DialogFooter className="px-6 pt-0 pb-6" variant="bare">
                    <Button
                      className="pill-button w-full sm:w-auto"
                      onClick={copyIssuedToken}
                      variant="outline"
                    >
                      <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
                      Copy
                    </Button>
                    <Button className="pill-button w-full sm:w-auto" onClick={acknowledgeToken}>
                      I saved this key
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <form className="contents" onSubmit={createKey}>
                  <DialogHeader className="gap-2 p-6 pr-16 pb-4">
                    <DialogTitle className="section-title text-balance">Create API key</DialogTitle>
                    <DialogDescription className="max-w-[42ch] text-pretty text-base">
                      Name the app or service that will use this key.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogPanel className="px-6 pt-0 pb-6">
                    <Field>
                      <FieldLabel>Name</FieldLabel>
                      <Input
                        autoComplete="off"
                        className="rounded-xl bg-background shadow-none before:hidden"
                        maxLength={80}
                        name="name"
                        onChange={changeName}
                        required
                        size="lg"
                        type="text"
                        value={name}
                      />
                    </Field>
                  </DialogPanel>
                  <DialogFooter className="px-6 pt-0 pb-6" variant="bare">
                    <Button
                      className="pill-button w-full sm:w-auto"
                      loading={creating}
                      type="submit"
                    >
                      Create key
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </DialogPopup>
          </Dialog>
        </div>

        <div aria-busy={loading} className="border-border border-x border-t">
          {error ? (
            <p
              className="m-0 border-border border-b px-4 py-4 text-destructive-foreground"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <div className="flex min-h-11 items-center justify-between gap-4 border-border border-b bg-muted/40 px-4 py-1.5">
            <h2 className="utility-label m-0 text-muted-foreground">API keys</h2>
            <p className="m-0 text-base text-muted-foreground tabular-nums">
              {loading ? <span>Loading…</span> : <span>{keys.length} active</span>}
            </p>
          </div>

          {!loading && keys.length === 0 ? (
            <div className="grid min-h-28 content-center gap-1 border-border border-b px-4 py-7">
              <p className="m-0 font-semibold text-base">No API keys yet</p>
              <p className="m-0 max-w-[60ch] text-pretty text-base text-muted-foreground">
                Create one when an app or service needs access.
              </p>
            </div>
          ) : null}

          {keys.map((key) => (
            <ApiKeyRow key={key.id} keyRecord={key} onRevoke={openRevoke} />
          ))}
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

      <Dialog onOpenChange={changeKeyActionOpen} open={Boolean(keyAction)}>
        <DialogPopup
          className="max-w-lg rounded-xl border-border bg-popover shadow-none before:hidden sm:data-ending-style:translate-y-2 sm:data-starting-style:translate-y-2 sm:data-ending-style:scale-100 sm:data-starting-style:scale-100"
          closeProps={{ className: "absolute end-4 top-4 rounded-full" }}
          showCloseButton={!keyActionPending}
        >
          <DialogHeader className="gap-2 p-6 pr-16 pb-4">
            <DialogTitle className="section-title text-balance">Revoke API key?</DialogTitle>
            <DialogDescription className="max-w-[42ch] text-pretty text-base">
              {describeKeyAction(keyAction)}
            </DialogDescription>
          </DialogHeader>
          {keyActionError ? (
            <DialogPanel className="px-6 pt-0 pb-4">
              <p className="m-0 text-destructive-foreground" role="alert">
                {keyActionError}
              </p>
            </DialogPanel>
          ) : null}
          <DialogFooter className="px-6 pt-0 pb-6" variant="bare">
            <Button
              className="pill-button w-full sm:w-auto"
              disabled={keyActionPending}
              onClick={cancelKeyAction}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="pill-button w-full sm:w-auto"
              loading={keyActionPending}
              onClick={confirmKeyAction}
              variant="destructive"
            >
              Revoke key
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <LegalFooter />
    </main>
  );
}
