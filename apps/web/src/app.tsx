import { Show, SignInButton, UserButton, useAuth, useClerk } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuLinkItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import type { AppRouter } from "../../server/src/api/router.ts";
import { type AccountApi, ApiKeysPage } from "./api-keys-page.tsx";
import { AppearanceMenu } from "./appearance-menu.tsx";
import { DevAutoSignIn } from "./dev-auto-sign-in.tsx";
import { type FreshnessApi, FreshnessPopover } from "./freshness-popover.tsx";
import { type MarkApi, MarkDetailPage } from "./mark-detail-page.tsx";
import { type OperatorSyncApi, OperatorSyncPage } from "./operator-sync-page.tsx";
import { type ReportsApi, ReportsPage } from "./reports-page.tsx";
import { type SearchApi, SearchPage } from "./search-page.tsx";

interface BrowserLocation {
  pathname: string;
  search: string;
  state: Record<string, unknown>;
}

const markPath = /^\/marks\/(\d{8})$/;

function browserLocation(): BrowserLocation {
  const { state } = window.history;
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    state: state && typeof state === "object" ? (state as Record<string, unknown>) : {},
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
  { replace = false, state = {} }: { replace?: boolean; state?: Record<string, unknown> } = {}
) {
  window.history[replace ? "replaceState" : "pushState"](state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

function plainPrimaryClick(event: ReactMouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function SignedInApp({ location }: { location: BrowserLocation }) {
  const { getToken } = useAuth();
  const client = useMemo(
    () =>
      createTRPCClient<AppRouter>({
        links: [
          httpLink({
            headers: async () => {
              const token = await getToken();
              return token ? { authorization: `Bearer ${token}` } : {};
            },
            url: "/api/trpc",
          }),
        ],
      }),
    [getToken]
  );
  const accountApi = useMemo<AccountApi>(
    () => ({
      create: (name) => client.account["api-keys"].create.mutate({ name }),
      list: () => client.account["api-keys"].list.query(),
      revoke: (id) => client.account["api-keys"].revoke.mutate({ id }),
    }),
    [client]
  );
  const markApi = useMemo<MarkApi>(
    () => ({
      get: (serialNumber) => client.marks.get.query({ serialNumber }),
    }),
    [client]
  );
  const searchApi = useMemo<SearchApi>(
    () => ({
      search: (input) => client.marks.search.query(input),
    }),
    [client]
  );
  const freshnessApi = useMemo<FreshnessApi>(
    () => ({
      status: () => client.sync.status.query(),
    }),
    [client]
  );
  const reportsApi = useMemo<ReportsApi>(
    () => ({ run: (input) => client.reports.run.query(input) }),
    [client]
  );
  const operatorApi = useMemo<OperatorSyncApi>(
    () => ({
      artifacts: (input) => client.ops.sync.artifacts.query(input),
      status: () => client.ops.sync.status.query(),
    }),
    [client]
  );
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    let active = true;
    client.viewer.role
      .query()
      .then((viewer) => {
        if (active) {
          setOperator(viewer.operator);
        }
      })
      .catch(() => {
        if (active) {
          setOperator(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client]);

  const handleMarkBack = useCallback(() => {
    if (location.state.tmturtleSearchEntry === true) {
      window.history.back();
    } else {
      setBrowserLocation("/search");
    }
  }, [location.state.tmturtleSearchEntry]);
  const handleSearchNavigate = useCallback((href: string, sourceSearch?: string) => {
    setBrowserLocation(href, {
      state: sourceSearch ? { searchReplacementSource: sourceSearch } : {},
    });
  }, []);
  const handleOpenMark = useCallback(
    (serialNumber: string, scrollOffset: number) => {
      setBrowserLocation(`${location.pathname}${location.search}`, {
        replace: true,
        state: { ...location.state, searchScrollOffset: scrollOffset },
      });
      setBrowserLocation(`/marks/${serialNumber}`, { state: { tmturtleSearchEntry: true } });
    },
    [location.pathname, location.search, location.state]
  );
  const handleReplacementLoaded = useCallback(() => {
    const state = { ...location.state, searchReplacementSource: undefined };
    setBrowserLocation(`${location.pathname}${location.search}`, { replace: true, state });
  }, [location.pathname, location.search, location.state]);

  const markRoute = location.pathname.match(markPath);
  const restoreScrollOffset =
    typeof location.state.searchScrollOffset === "number" ? location.state.searchScrollOffset : 0;
  let page: ReactNode;
  if (markRoute?.[1]) {
    page = <MarkDetailPage api={markApi} onBack={handleMarkBack} serialNumber={markRoute[1]} />;
  } else if (location.pathname === "/reports") {
    page = (
      <ReportsPage
        api={reportsApi}
        key={location.search}
        onNavigate={handleSearchNavigate}
        onOpenMark={handleOpenMark}
        restoreScrollOffset={restoreScrollOffset}
        search={location.search}
      />
    );
  } else if (location.pathname === "/ops/sync") {
    page = <OperatorSyncPage api={operatorApi} />;
  } else if (location.pathname === "/settings/api-keys") {
    page = <ApiKeysPage api={accountApi} />;
  } else {
    const replacementSourceSearch =
      typeof location.state.searchReplacementSource === "string"
        ? location.state.searchReplacementSource
        : undefined;
    page = (
      <SearchPage
        api={searchApi}
        onNavigate={handleSearchNavigate}
        onOpenMark={handleOpenMark}
        onReplacementLoaded={handleReplacementLoaded}
        replacementSourceSearch={replacementSourceSearch}
        restoreScrollOffset={restoreScrollOffset}
        search={location.search}
      />
    );
  }

  return (
    <>
      <TopBar freshnessApi={freshnessApi} operator={operator} />
      {page}
    </>
  );
}

function TopBar({
  freshnessApi,
  operator = false,
}: {
  freshnessApi?: FreshnessApi;
  operator?: boolean;
}) {
  const navigate = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!plainPrimaryClick(event)) {
      return;
    }
    event.preventDefault();
    setBrowserLocation(event.currentTarget.getAttribute("href") ?? "/search");
  }, []);

  return (
    <header className="grid min-h-[3.75rem] grid-cols-[1fr_auto_auto] items-center border-border border-b px-[clamp(1rem,3vw,3rem)] py-3 max-[48rem]:grid-cols-[1fr_auto] max-[48rem]:gap-y-1">
      <a
        className="whitespace-nowrap font-extrabold text-[0.82rem] text-inherit uppercase leading-none tracking-[-0.02em] no-underline"
        href="/search"
        onClick={navigate}
      >
        Trademark Turtle
      </a>
      <Show when="signed-in">
        <nav
          aria-label="Primary"
          className="flex items-center gap-3.5 text-[0.8125rem] max-[48rem]:col-span-full max-[48rem]:row-start-2 max-[48rem]:w-full max-[48rem]:justify-start max-[48rem]:gap-x-4 max-[48rem]:gap-y-1 max-[48rem]:overflow-x-auto [&_a:hover]:underline [&_a:hover]:underline-offset-[0.3em] [&_a]:text-inherit [&_a]:no-underline max-[48rem]:[&_a]:inline-flex max-[48rem]:[&_a]:min-h-11 max-[48rem]:[&_a]:shrink-0 max-[48rem]:[&_a]:items-center max-[48rem]:[&_button]:inline-flex max-[48rem]:[&_button]:min-h-11 max-[48rem]:[&_button]:shrink-0 max-[48rem]:[&_button]:items-center"
        >
          <a href="/search" onClick={navigate}>
            Search
          </a>
          <Menu>
            <MenuTrigger render={<Button size="sm" variant="ghost" />}>Reports</MenuTrigger>
            <MenuPopup align="start">
              <MenuLinkItem href="/reports?event=filed&window=previous-week" onClick={navigate}>
                Filed previous week
              </MenuLinkItem>
              <MenuLinkItem
                href="/reports?event=registered&window=previous-week"
                onClick={navigate}
              >
                Registered previous week
              </MenuLinkItem>
              <MenuLinkItem href="/reports?event=published-for-opposition" onClick={navigate}>
                Published for opposition
              </MenuLinkItem>
            </MenuPopup>
          </Menu>
          <a href="/settings/api-keys" onClick={navigate}>
            API Keys
          </a>
          {operator ? (
            <a href="/ops/sync" onClick={navigate}>
              Operations
            </a>
          ) : null}
          {freshnessApi ? <FreshnessPopover api={freshnessApi} /> : null}
        </nav>
        <div className="ml-3.5 flex items-center gap-2 max-[48rem]:col-start-2 max-[48rem]:row-start-1 max-[48rem]:ml-2">
          <AppearanceMenu />
          <UserButton />
        </div>
      </Show>
      <Show when="signed-out">
        <div className="ml-3.5 flex items-center gap-2 max-[48rem]:col-start-2 max-[48rem]:row-start-1 max-[48rem]:ml-2">
          <SignInButton mode="modal">
            <Button>Sign in</Button>
          </SignInButton>
          <AppearanceMenu />
        </div>
      </Show>
    </header>
  );
}

function SignedOutSearch({ search }: { search: string }) {
  const { openSignIn } = useClerk();
  const locationQuery = new URLSearchParams(search).get("q") ?? "";
  const [query, setQuery] = useState(locationQuery);
  useEffect(() => setQuery(locationQuery), [locationQuery]);
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
  }, []);
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedQuery = query.trim();
      if (!normalizedQuery || normalizedQuery.length > 200) {
        return;
      }
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
    },
    [openSignIn, query]
  );

  return (
    <main className="mx-auto grid min-h-[calc(100vh-3.75rem)] max-w-[100rem] content-center gap-8 px-[clamp(1rem,3vw,3rem)] py-[clamp(2rem,5vw,5.5rem)]">
      <p className="mb-[0.85rem] font-[650] text-[0.72rem] uppercase tracking-[0.12em]">
        Private trademark search / Class 025
      </p>
      <h1 className="m-0 font-black text-[clamp(2.75rem,12.5vw,14rem)] leading-[0.78] tracking-[-0.055em]">
        TRADEMARK
        <br />
        TURTLE
      </h1>
      <p className="m-0 max-w-[30rem] text-[1.2rem]">
        Sign in with your MerchBase account to run your search.
      </p>
      <form
        className="grid max-w-[70rem] grid-cols-[minmax(0,1fr)_auto] gap-3 p-0 [--search-control-height:clamp(3.5rem,7vw,5.5rem)] max-[48rem]:grid-cols-1 [&>[data-slot=button]]:h-[var(--search-control-height)] [&>[data-slot=button]]:px-[clamp(1.5rem,3vw,2.5rem)] [&>[data-slot=button]]:text-[clamp(1.125rem,1.5vw,1.4rem)] [&_[data-slot=input-control]]:h-[var(--search-control-height)] [&_[data-slot=input-control]]:rounded-[var(--radius)] [&_[data-slot=input]]:h-full [&_[data-slot=input]]:px-[clamp(1rem,2vw,1.5rem)] [&_[data-slot=input]]:py-0 [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:text-[clamp(1.25rem,3vw,2.4rem)] [&_[data-slot=input]]:leading-none [&_[data-slot=input]]:tracking-[-0.035em]"
        onSubmit={handleSubmit}
      >
        <label className="sr-only" htmlFor="signed-out-search">
          Search trademarks
        </label>
        <Input
          id="signed-out-search"
          maxLength={200}
          onChange={handleChange}
          placeholder="Search a word mark"
          required
          size="lg"
          type="search"
          value={query}
        />
        <Button size="xl" type="submit">
          Search
        </Button>
      </form>
    </main>
  );
}

export function App() {
  const location = useBrowserLocation();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
  );

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
