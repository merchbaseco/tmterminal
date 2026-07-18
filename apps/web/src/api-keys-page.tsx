import type { inferRouterOutputs } from "@trpc/server";
import { EllipsisIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
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
import type { AppRouter } from "../../server/src/api/router.ts";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ApiKey = RouterOutputs["account"]["api-keys"]["list"][number];
type CreatedApiKey = RouterOutputs["account"]["api-keys"]["create"];

export type AccountApi = {
  create(name: string): Promise<CreatedApiKey>;
  list(): Promise<ApiKey[]>;
  revoke(id: string): Promise<ApiKey>;
};

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function ApiKeysPage({ api }: { api: AccountApi }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
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

  async function createKey(event: FormEvent<HTMLFormElement>) {
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
  }

  async function revokeKey(id: string) {
    setError(null);
    try {
      const revoked = await api.revoke(id);
      setKeys((current) => current.map((key) => (key.id === id ? revoked : key)));
    } catch {
      setError("API key could not be revoked.");
    }
  }

  function acknowledgeToken() {
    setIssuedToken(null);
    setCreateOpen(false);
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-3.75rem)] max-w-[100rem] px-[clamp(1rem,3vw,3rem)] py-[clamp(2rem,5vw,5.5rem)]">
      <section className="grid grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)] items-end gap-8 max-[48rem]:grid-cols-1">
        <div>
          <p className="mb-[0.85rem] font-[650] text-[0.72rem] uppercase tracking-[0.12em]">
            Account / credentials
          </p>
          <h1 className="m-0 font-black text-[clamp(4.75rem,13vw,13rem)] leading-[0.78] tracking-[-0.055em]">
            API KEYS
          </h1>
        </div>
        <p className="m-0 max-w-[27rem] text-[clamp(1.15rem,2vw,1.7rem)] leading-[1.15]">
          Create credentials for the CLI and typed clients. New tokens appear once.
        </p>
      </section>

      <div className="mt-[clamp(3rem,8vw,7rem)] flex items-center justify-between border-border border-y py-3">
        <p className="m-0 font-[650] text-[0.72rem] uppercase tracking-[0.12em]">
          {keys.length} total
        </p>
        <Dialog
          onOpenChange={(open) => {
            if (!(issuedToken || creating)) {
              setCreateOpen(open);
            }
          }}
          open={createOpen}
        >
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
                    className="block wrap-anywhere select-all bg-muted p-4 font-sans"
                    data-testid="issued-token"
                  >
                    {issuedToken}
                  </code>
                </DialogPanel>
                <DialogFooter>
                  <Button
                    onClick={() => void navigator.clipboard.writeText(issuedToken)}
                    variant="outline"
                  >
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
                      onChange={(event) => setName(event.target.value)}
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
            className="grid min-h-[6.5rem] grid-cols-[minmax(11rem,1.2fr)_minmax(28rem,2fr)_auto] items-center gap-8 border-border border-t py-4 first:border-t-0 max-[48rem]:grid-cols-1 max-[48rem]:gap-4"
            key={key.id}
          >
            <div className="grid gap-[0.3rem]">
              <strong className="text-[1.35rem]">{key.name}</strong>
              <span className="text-[0.72rem] text-muted-foreground uppercase tracking-[0.1em]">
                {key.status}
              </span>
            </div>
            <dl className="m-0 grid grid-cols-3 gap-4 max-[48rem]:grid-cols-2 [&>div]:grid [&>div]:gap-[0.35rem] [&_dd]:m-0 [&_dd]:text-[0.9rem] [&_dt]:text-[0.68rem] [&_dt]:text-muted-foreground [&_dt]:uppercase [&_dt]:tracking-[0.09em]">
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
              <Menu>
                <MenuTrigger
                  aria-label={`Actions for ${key.name}`}
                  render={<Button size="icon" variant="ghost" />}
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => void revokeKey(key.id)} variant="destructive">
                    Revoke
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : (
              <span aria-hidden="true" />
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
