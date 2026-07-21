import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, MoreVerticalIcon } from "@hugeicons-pro/core-stroke-rounded";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { AppRouter } from "../../server/src/api/router.ts";
import { LegalFooter } from "./legal-footer.tsx";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ApiKey = RouterOutputs["account"]["api-keys"]["list"][number];
type CreatedApiKey = RouterOutputs["account"]["api-keys"]["create"];

export interface AccountApi {
  create: (name: string) => Promise<CreatedApiKey>;
  list: () => Promise<ApiKey[]>;
  revoke: (id: string) => Promise<ApiKey>;
}

interface ApiKeyActionsProps {
  id: string;
  name: string;
  onRevoke: (id: string) => Promise<void>;
}

function ApiKeyActions({ id, name, onRevoke }: ApiKeyActionsProps) {
  const revoke = useCallback(() => {
    onRevoke(id);
  }, [id, onRevoke]);

  return (
    <Menu>
      <MenuTrigger
        aria-label={`Actions for ${name}`}
        render={<Button size="icon" variant="ghost" />}
      >
        <HugeiconsIcon icon={MoreVerticalIcon} />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={revoke} variant="destructive">
          Revoke
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function AccountPage({ api, email }: { api: AccountApi; email: string | null }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

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

  const revokeKey = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const revoked = await api.revoke(id);
        setKeys((current) => current.map((key) => (key.id === id ? revoked : key)));
      } catch {
        setError("API key could not be revoked.");
      }
    },
    [api]
  );

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

  return (
    <main className="page-shell isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col py-[clamp(2rem,5vw,5.5rem)]">
      <section className="grid grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] items-end gap-8 max-[90rem]:grid-cols-1">
        <div>
          <p className="mb-[0.85rem] font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
            Account / Access
          </p>
          <h1 className="m-0 font-black text-[clamp(3.25rem,13vw,13rem)] leading-[0.78] tracking-[-0.055em]">
            ACCOUNT
          </h1>
        </div>
        <p className="m-0 max-w-[27rem] text-base">
          Your MerchBase sign-in and the credentials that call the service.
        </p>
      </section>

      {email ? (
        <dl className="mt-[clamp(3rem,8vw,7rem)] border-border border-y py-4">
          <div className="grid gap-1">
            <dt className="font-[650] text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
              Signed in as
            </dt>
            <dd className="m-0 text-base">{email}</dd>
          </div>
        </dl>
      ) : null}

      <div
        className={cn(
          "flex items-center justify-between border-border border-y py-3",
          email ? "mt-[clamp(2rem,4vw,3.5rem)]" : "mt-[clamp(3rem,8vw,7rem)]"
        )}
      >
        <p className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]">
          API keys — {keys.length} total
        </p>
        <Dialog onOpenChange={changeCreateOpen} open={createOpen}>
          <DialogTrigger render={<Button />}>Create API key</DialogTrigger>
          <DialogPopup showCloseButton={!(issuedToken || creating)}>
            {issuedToken ? (
              <>
                <DialogHeader>
                  <DialogTitle>Save this key now</DialogTitle>
                  <DialogDescription>
                    Trademark Turtle will not show this token again.
                  </DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <code
                    className="wrap-anywhere block select-all bg-muted p-4 font-sans"
                    data-testid="issued-token"
                  >
                    {issuedToken}
                  </code>
                </DialogPanel>
                <DialogFooter>
                  <Button onClick={copyIssuedToken} variant="outline">
                    <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
                    Copy
                  </Button>
                  <Button onClick={acknowledgeToken}>I saved this key</Button>
                </DialogFooter>
              </>
            ) : (
              <form onSubmit={createKey}>
                <DialogHeader>
                  <DialogTitle>Create API key</DialogTitle>
                  <DialogDescription>Use a name that identifies the caller.</DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <Field>
                    <FieldLabel>Name</FieldLabel>
                    <Input
                      autoComplete="off"
                      maxLength={80}
                      onChange={changeName}
                      required
                      value={name}
                    />
                  </Field>
                </DialogPanel>
                <DialogFooter>
                  <Button loading={creating} type="submit">
                    Create key
                  </Button>
                </DialogFooter>
              </form>
            )}
          </DialogPopup>
        </Dialog>
      </div>

      {error ? (
        <p className="m-0 py-8 text-destructive-foreground" role="alert">
          {error}
        </p>
      ) : null}

      <section aria-busy={loading} aria-label="API keys" className="border-border border-b">
        {loading ? <p className="m-0 py-8">Loading API keys…</p> : null}
        {!loading && keys.length === 0 ? <p className="m-0 py-8">No API keys yet.</p> : null}
        {keys.map((key) => (
          <article
            className="grid grid-cols-[minmax(11rem,1.2fr)_minmax(28rem,2fr)_auto] items-center gap-8 border-border border-t py-5 first:border-t-0 max-[48rem]:grid-cols-1 max-[48rem]:gap-4"
            key={key.id}
          >
            <div className="grid gap-[0.3rem]">
              <strong className="text-base">{key.name}</strong>
              <span className="text-[0.75rem] text-muted-foreground uppercase tracking-[0.1em]">
                {key.status}
              </span>
            </div>
            <dl className="m-0 grid grid-cols-3 gap-4 max-[64rem]:grid-cols-2 [&>div]:grid [&>div]:gap-[0.35rem] [&_dd]:m-0 [&_dd]:text-base [&_dt]:text-[0.75rem] [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dt]:tracking-[0.1em]">
              <div>
                <dt>Suffix</dt>
                <dd>••••{key.suffix}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatDate(key.createdAt)}</dd>
              </div>
              <div>
                <dt>Last used</dt>
                <dd>{formatDate(key.lastUsedAt)}</dd>
              </div>
            </dl>
            {key.status === "active" ? (
              <ApiKeyActions id={key.id} name={key.name} onRevoke={revokeKey} />
            ) : (
              <span aria-hidden="true" />
            )}
          </article>
        ))}
      </section>
      <LegalFooter />
    </main>
  );
}
