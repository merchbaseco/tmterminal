import { Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import { createTRPCClient, httpLink } from "@trpc/client";
import { useMemo } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";
import { ApiKeysPage, type AccountApi } from "./api-keys-page.tsx";
import { Button } from "@/components/ui/button";
import { DevAutoSignIn } from "./dev-auto-sign-in.tsx";

function SignedInAccount() {
  const { getToken } = useAuth();
  const api = useMemo<AccountApi>(() => {
    const client = createTRPCClient<AppRouter>({
      links: [
        httpLink({
          headers: async () => {
            const token = await getToken();
            return token ? { authorization: `Bearer ${token}` } : {};
          },
          url: "/api/trpc",
        }),
      ],
    });

    return {
      create: (name) => client.account["api-keys"].create.mutate({ name }),
      list: () => client.account["api-keys"].list.query(),
      revoke: (id) => client.account["api-keys"].revoke.mutate({ id }),
    };
  }, [getToken]);

  return <ApiKeysPage api={api} />;
}

function TopBar() {
  return (
    <header className="top-bar">
      <a className="wordmark" href="/settings/api-keys">Trademark Turtle</a>
      <nav aria-label="Account">
        <Show when="signed-in">
          <span>API Keys</span>
          <UserButton />
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
        </Show>
      </nav>
    </header>
  );
}

export function App() {
  return (
    <>
      <TopBar />
      <Show when="signed-in">
        <SignedInAccount />
      </Show>
      <Show when="signed-out">
        <>
          <DevAutoSignIn />
          <main className="signed-out-shell">
            <p className="eyebrow">Private trademark tools</p>
            <h1>TRADEMARK<br />TURTLE</h1>
            <p>Sign in with your MerchBase account to manage API keys.</p>
            <SignInButton mode="modal">
              <Button size="lg">Sign in</Button>
            </SignInButton>
          </main>
        </>
      </Show>
    </>
  );
}
