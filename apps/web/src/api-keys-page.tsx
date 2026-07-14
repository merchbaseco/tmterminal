import { useEffect, useState, type FormEvent } from "react";
import { EllipsisIcon } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "../../server/src/api/router.ts";
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

type RouterOutputs = inferRouterOutputs<AppRouter>;
type ApiKey = RouterOutputs["account"]["api-keys"]["list"][number];
type CreatedApiKey = RouterOutputs["account"]["api-keys"]["create"];

export type AccountApi = {
  create(name: string): Promise<CreatedApiKey>;
  list(): Promise<ApiKey[]>;
  revoke(id: string): Promise<ApiKey>;
};

function formatDate(value: string | null) {
  if (!value) return "Never";
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
        if (active) setKeys(listed);
      })
      .catch(() => {
        if (active) setError("API keys could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
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
    <main className="page-shell">
      <section className="settings-heading">
        <div>
          <p className="eyebrow">Account / credentials</p>
          <h1>API KEYS</h1>
        </div>
        <p className="settings-intro">
          Create credentials for the CLI and typed clients. New tokens appear once.
        </p>
      </section>

      <div className="section-rule">
        <p>{keys.length} total</p>
        <Dialog
          onOpenChange={(open) => {
            if (!issuedToken && !creating) setCreateOpen(open);
          }}
          open={createOpen}
        >
          <DialogTrigger render={<Button />}>Create API key</DialogTrigger>
          <DialogPopup showCloseButton={!issuedToken && !creating}>
            {issuedToken ? (
              <>
                <DialogHeader>
                  <DialogTitle>Save this key now</DialogTitle>
                  <DialogDescription>
                    Trademark Turtle will not show this token again.
                  </DialogDescription>
                </DialogHeader>
                <DialogPanel>
                  <code className="issued-token" data-testid="issued-token">
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

      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <section aria-busy={loading} aria-label="API keys" className="key-list">
        {loading ? <p className="empty-row">Loading API keys…</p> : null}
        {!loading && keys.length === 0 ? <p className="empty-row">No API keys yet.</p> : null}
        {keys.map((key) => (
          <article className="key-row" key={key.id}>
            <div className="key-name">
              <strong>{key.name}</strong>
              <span>{key.status}</span>
            </div>
            <dl>
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
