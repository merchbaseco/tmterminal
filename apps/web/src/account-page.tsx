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
import { LegalFooter } from "./legal-footer.tsx";
import { PageMasthead } from "./page-masthead.tsx";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ApiKey = RouterOutputs["account"]["api-keys"]["list"][number];
type CreatedApiKey = RouterOutputs["account"]["api-keys"]["create"];

export interface AccountApi {
  create: (name: string) => Promise<CreatedApiKey>;
  delete: (id: string) => Promise<{ id: string }>;
  list: () => Promise<ApiKey[]>;
  revoke: (id: string) => Promise<ApiKey>;
}

interface KeyAction {
  key: ApiKey;
  type: "delete" | "revoke";
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function describeKeyAction(action: KeyAction | null) {
  if (!action) {
    return "";
  }
  if (action.type === "delete") {
    return `“${action.key.name}” will be permanently removed from account history. This cannot be undone.`;
  }
  return `“${action.key.name}” will stop working immediately. This cannot be undone.`;
}

function ApiKeyRow({
  keyRecord,
  onDelete,
  onRevoke,
}: {
  keyRecord: ApiKey;
  onDelete?: (key: ApiKey) => void;
  onRevoke?: (key: ApiKey) => void;
}) {
  const revoke = useCallback(() => {
    onRevoke?.(keyRecord);
  }, [keyRecord, onRevoke]);

  const deleteKey = useCallback(() => {
    onDelete?.(keyRecord);
  }, [keyRecord, onDelete]);

  return (
    <article className="grid grid-cols-[minmax(10rem,5fr)_minmax(16rem,8fr)_auto] items-stretch border-border border-b last:border-b-0 max-[48rem]:grid-cols-1">
      <div className="grid min-w-0 content-center gap-1 px-6 py-5 max-[48rem]:pb-2">
        <p className="m-0 truncate font-semibold text-base">{keyRecord.name}</p>
        <p className="m-0 text-muted-foreground tabular-nums">••••{keyRecord.suffix}</p>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-6 px-6 py-5 max-[48rem]:pt-2">
        <div className="grid content-center gap-1">
          <dt className="utility-label text-foreground">Created</dt>
          <dd className="m-0 text-base text-muted-foreground">{formatDate(keyRecord.createdAt)}</dd>
        </div>
        <div className="grid content-center gap-1">
          <dt className="utility-label text-foreground">Last used</dt>
          <dd className="m-0 text-base text-muted-foreground">
            {formatDate(keyRecord.lastUsedAt)}
          </dd>
        </div>
      </dl>
      {onRevoke ? (
        <div className="flex items-center justify-end px-6 py-5 max-[48rem]:justify-start max-[48rem]:pt-2">
          <Button
            aria-label={`Revoke ${keyRecord.name}`}
            className="pill-button"
            onClick={revoke}
            variant="destructive-outline"
          >
            Revoke
          </Button>
        </div>
      ) : null}
      {onDelete ? (
        <div className="flex items-center justify-end px-6 py-5 max-[48rem]:justify-start max-[48rem]:pt-2">
          <Button
            aria-label={`Delete ${keyRecord.name}`}
            className="pill-button"
            onClick={deleteKey}
            size="icon"
            variant="destructive-outline"
          >
            <HugeiconsIcon aria-hidden="true" icon={Delete02Icon} />
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function AccountPage({ api }: { api: AccountApi }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [keyAction, setKeyAction] = useState<KeyAction | null>(null);
  const [keyActionPending, setKeyActionPending] = useState(false);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);

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
      if (keyAction.type === "revoke") {
        const revoked = await api.revoke(keyAction.key.id);
        setKeys((current) => current.map((key) => (key.id === keyAction.key.id ? revoked : key)));
      } else {
        const deleted = await api.delete(keyAction.key.id);
        setKeys((current) => current.filter((key) => key.id !== deleted.id));
      }
      setKeyAction(null);
    } catch {
      setKeyActionError(
        keyAction.type === "revoke"
          ? "API key could not be revoked. Try again."
          : "API key could not be deleted. Try again."
      );
    } finally {
      setKeyActionPending(false);
    }
  }, [api, keyAction]);

  const openRevoke = useCallback((key: ApiKey) => {
    setKeyActionError(null);
    setKeyAction({ key, type: "revoke" });
  }, []);

  const openDelete = useCallback((key: ApiKey) => {
    setKeyActionError(null);
    setKeyAction({ key, type: "delete" });
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

  const activeKeys = keys.filter((key) => key.status === "active");
  const revokedKeys = keys.filter((key) => key.status === "revoked");

  return (
    <main className="page-shell page-start isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col pb-[clamp(2rem,5vw,5.5rem)]">
      <PageMasthead description="Your keys. Your call." title="ACCESS CONTROL" />

      <section aria-label="Account access" className="mt-[clamp(2.5rem,5vw,4.5rem)]">
        <div className="flex items-end justify-between gap-8 max-[48rem]:grid max-[48rem]:gap-6">
          <div className="grid min-w-0 gap-2">
            <h2 className="section-title m-0 text-balance">API keys</h2>
            <p className="m-0 max-w-[48ch] text-pretty text-base text-muted-foreground">
              Create one key per trusted service. Revoke it as soon as it is no longer needed.
            </p>
          </div>
          <Dialog onOpenChange={changeCreateOpen} open={createOpen}>
            <DialogTrigger render={<Button className="pill-button max-[48rem]:w-full" />}>
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
                    <DialogDescription className="max-w-[42ch] text-pretty text-base sm:text-sm">
                      This token will not be shown again.
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
                    <DialogDescription className="max-w-[42ch] text-pretty text-base sm:text-sm">
                      Name the person, service, or integration that will use it.
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

        <div className="mt-[clamp(2rem,4vw,3.5rem)] border-border border-t">
          {error ? (
            <p className="m-0 border-border border-b py-4 text-destructive-foreground" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-[minmax(15rem,4fr)_minmax(0,9fr)] border-border border-b max-[48rem]:grid-cols-1">
            <div className="grid content-start gap-2 border-border border-r py-5 pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:border-r-0 max-[48rem]:border-b max-[48rem]:pr-0">
              <p className="utility-label m-0 text-primary">Active</p>
              <p className="m-0 text-base text-muted-foreground tabular-nums">
                {activeKeys.length} {activeKeys.length === 1 ? "key" : "keys"}
              </p>
            </div>
            <div aria-busy={loading} className="min-w-0">
              {loading ? <p className="m-0 px-6 py-8">Loading API keys…</p> : null}
              {!loading && activeKeys.length === 0 ? (
                <p className="m-0 px-6 py-8 text-muted-foreground">
                  No active keys. Create one when a service needs access.
                </p>
              ) : null}
              {activeKeys.map((key) => (
                <ApiKeyRow key={key.id} keyRecord={key} onRevoke={openRevoke} />
              ))}
            </div>
          </div>

          {!loading && revokedKeys.length > 0 ? (
            <div className="grid grid-cols-[minmax(15rem,4fr)_minmax(0,9fr)] border-border border-b max-[48rem]:grid-cols-1">
              <div className="grid content-start gap-2 border-border border-r py-5 pr-[clamp(1.5rem,3vw,3rem)] max-[48rem]:border-r-0 max-[48rem]:border-b max-[48rem]:pr-0">
                <p className="utility-label m-0 text-muted-foreground">Revoked history</p>
                <p className="m-0 text-base text-muted-foreground tabular-nums">
                  {revokedKeys.length} {revokedKeys.length === 1 ? "key" : "keys"}
                </p>
              </div>
              <div className="min-w-0">
                {revokedKeys.map((key) => (
                  <ApiKeyRow key={key.id} keyRecord={key} onDelete={openDelete} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <Dialog onOpenChange={changeKeyActionOpen} open={Boolean(keyAction)}>
        <DialogPopup
          className="max-w-lg rounded-xl border-border bg-popover shadow-none before:hidden sm:data-ending-style:translate-y-2 sm:data-starting-style:translate-y-2 sm:data-ending-style:scale-100 sm:data-starting-style:scale-100"
          closeProps={{ className: "absolute end-4 top-4 rounded-full" }}
          showCloseButton={!keyActionPending}
        >
          <DialogHeader className="gap-2 p-6 pr-16 pb-4">
            <DialogTitle className="section-title text-balance">
              {keyAction?.type === "delete" ? "Delete API key?" : "Revoke API key?"}
            </DialogTitle>
            <DialogDescription className="max-w-[42ch] text-pretty text-base sm:text-sm">
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
              {keyAction?.type === "delete" ? "Delete key" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <LegalFooter />
    </main>
  );
}
