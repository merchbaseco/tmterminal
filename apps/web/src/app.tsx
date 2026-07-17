import { Show, SignInButton, UserButton, useAuth, useClerk } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";
import { ApiKeysPage, type AccountApi } from "./api-keys-page.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DevAutoSignIn } from "./dev-auto-sign-in.tsx";
import { FreshnessPopover, type FreshnessApi } from "./freshness-popover.tsx";
import { MarkDetailPage, type MarkApi } from "./mark-detail-page.tsx";
import { OperatorSyncPage, type OperatorSyncApi } from "./operator-sync-page.tsx";
import { SearchPage, type SearchApi } from "./search-page.tsx";

type BrowserLocation = {
  pathname: string;
  search: string;
  state: Record<string, unknown>;
};

function browserLocation(): BrowserLocation {
  const state = window.history.state;
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    state: state && typeof state === "object" ? state as Record<string, unknown> : {},
  };
}

function useBrowserLocation() {
  const [location, setLocation] = useState(browserLocation);
  useEffect(() => {
    const update = () => setLocation(browserLocation());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return location;
}

function setBrowserLocation(
  href: string,
  { replace = false, state = {} }: { replace?: boolean; state?: Record<string, unknown> } = {},
) {
  window.history[replace ? "replaceState" : "pushState"](state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

function plainPrimaryClick(event: ReactMouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function SignedInApp({ location }: { location: BrowserLocation }) {
  const { getToken } = useAuth();
  const client = useMemo(() => createTRPCClient<AppRouter>({
    links: [
      httpLink({
        headers: async () => {
          const token = await getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        url: "/api/trpc",
      }),
    ],
  }), [getToken]);
  const accountApi = useMemo<AccountApi>(() => ({
    create: (name) => client.account["api-keys"].create.mutate({ name }),
    list: () => client.account["api-keys"].list.query(),
    revoke: (id) => client.account["api-keys"].revoke.mutate({ id }),
  }), [client]);
  const markApi = useMemo<MarkApi>(() => ({
    get: (serialNumber) => client.marks.get.query({ serialNumber }),
  }), [client]);
  const searchApi = useMemo<SearchApi>(() => ({
    search: (input) => client.marks.search.query(input),
  }), [client]);
  const freshnessApi = useMemo<FreshnessApi>(() => ({
    status: () => client.sync.status.query(),
  }), [client]);
  const operatorApi = useMemo<OperatorSyncApi>(() => ({
    artifacts: (input) => client.ops.sync.artifacts.query(input),
    status: () => client.ops.sync.status.query(),
  }), [client]);
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    let active = true;
    void client.viewer.role.query().then((viewer) => {
      if (active) setOperator(viewer.operator);
    }).catch(() => {
      if (active) setOperator(false);
    });
    return () => { active = false; };
  }, [client]);

  const markRoute = location.pathname.match(/^\/marks\/(\d{8})$/);
  let page;
  if (markRoute?.[1]) {
    page = (
      <MarkDetailPage
        api={markApi}
        onBack={() => {
          if (location.state.tmturtleSearchEntry === true) {
            window.history.back();
          } else {
            setBrowserLocation("/search");
          }
        }}
        serialNumber={markRoute[1]}
      />
    );
  } else if (location.pathname === "/ops/sync") {
    page = <OperatorSyncPage api={operatorApi} />;
  } else if (location.pathname === "/settings/api-keys") {
    page = <ApiKeysPage api={accountApi} />;
  } else {
    const restoreScrollOffset = typeof location.state.searchScrollOffset === "number"
      ? location.state.searchScrollOffset
      : 0;
    const replacementSourceSearch = typeof location.state.searchReplacementSource === "string"
      ? location.state.searchReplacementSource
      : undefined;
    page = (
      <SearchPage
        api={searchApi}
        onNavigate={(href, sourceSearch) => setBrowserLocation(href, {
          state: sourceSearch ? { searchReplacementSource: sourceSearch } : {},
        })}
        onOpenMark={(serialNumber, scrollOffset) => {
          setBrowserLocation(
            `${location.pathname}${location.search}`,
            {
              replace: true,
              state: { ...location.state, searchScrollOffset: scrollOffset },
            },
          );
          setBrowserLocation(`/marks/${serialNumber}`, { state: { tmturtleSearchEntry: true } });
        }}
        onReplacementLoaded={() => {
          const state = { ...location.state };
          delete state.searchReplacementSource;
          setBrowserLocation(`${location.pathname}${location.search}`, { replace: true, state });
        }}
        replacementSourceSearch={replacementSourceSearch}
        restoreScrollOffset={restoreScrollOffset}
        search={location.search}
      />
    );
  }

  return <><TopBar freshnessApi={freshnessApi} operator={operator} />{page}</>;
}

function TopBar({ freshnessApi, operator = false }: { freshnessApi?: FreshnessApi; operator?: boolean }) {
  function navigate(event: ReactMouseEvent<HTMLAnchorElement>, href: string) {
    if (!plainPrimaryClick(event)) return;
    event.preventDefault();
    setBrowserLocation(href);
  }

  return (
    <header className="top-bar">
      <a className="wordmark" href="/search" onClick={(event) => navigate(event, "/search")}>Trademark Turtle</a>
      <nav aria-label="Primary">
        <Show when="signed-in">
          <a href="/search" onClick={(event) => navigate(event, "/search")}>Search</a>
          <a href="/settings/api-keys" onClick={(event) => navigate(event, "/settings/api-keys")}>API Keys</a>
          {operator ? <a href="/ops/sync" onClick={(event) => navigate(event, "/ops/sync")}>Sync ops</a> : null}
          {freshnessApi ? <FreshnessPopover api={freshnessApi} /> : null}
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

function SignedOutSearch({ search }: { search: string }) {
  const { openSignIn } = useClerk();
  const locationQuery = new URLSearchParams(search).get("q") ?? "";
  const [query, setQuery] = useState(locationQuery);
  useEffect(() => setQuery(locationQuery), [locationQuery]);

  return (
    <main className="signed-out-shell">
      <p className="eyebrow">Private trademark search / Class 025</p>
      <h1>TRADEMARK<br />TURTLE</h1>
      <p>Compose one literal query. Sign in with your MerchBase account to run it.</p>
      <form
        className="search-form signed-out-search"
        onSubmit={(event) => {
          event.preventDefault();
          const normalizedQuery = query.trim();
          if (!normalizedQuery || normalizedQuery.length > 200) return;
          const parameters = new URLSearchParams({
            exact: "true",
            mode: "multi",
            partial: "true",
            q: normalizedQuery,
            registered: "all",
            sort: "relevance",
            status: "all",
            type: "all",
          });
          setBrowserLocation(`/search?${parameters.toString()}`, { replace: true });
          openSignIn();
        }}
      >
        <label className="sr-only" htmlFor="signed-out-search">Search trademarks</label>
        <Input
          id="signed-out-search"
          maxLength={200}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="One literal mark query"
          required
          size="lg"
          type="search"
          value={query}
        />
        <Button size="xl" type="submit">Search</Button>
      </form>
    </main>
  );
}

export function App() {
  const location = useBrowserLocation();
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <Show when="signed-in">
        <SignedInApp location={location} />
      </Show>
      <Show when="signed-out">
        <TopBar />
        <DevAutoSignIn />
        <SignedOutSearch search={location.search} />
      </Show>
    </QueryClientProvider>
  );
}
