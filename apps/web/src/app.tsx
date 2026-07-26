import { Show, SignInButton, useAuth, useClerk } from "@clerk/react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ComputerTerminal01Icon,
  Menu01Icon,
  Search01Icon,
} from "@hugeicons-pro/core-stroke-rounded";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import {
  type ChangeEvent,
  type FormEvent,
  lazy,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu, MenuLinkItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import type { AppRouter } from "../../server/src/api/router.ts";
import { AccountMenu } from "./account-menu.tsx";
import { type AccountApi, AccountPage, type AccountPreferencesApi } from "./account-page.tsx";
import { appearanceChangedEvent, applyAppearance, savedAppearance } from "./appearance.ts";
import { type BulkCheckApi, BulkCheckPage } from "./bulk-check-page.tsx";
import { CheckTextPage, type TextCheckApi } from "./check-text-page.tsx";
import { DevAutoSignIn } from "./dev-auto-sign-in.tsx";
import { HelpPage } from "./help-page.tsx";
import { type MarkApi, MarkDetailPage } from "./mark-detail-page.tsx";
import type { OperatorSyncApi, PublicStatusApi } from "./operator-sync-page.tsx";
import { type SearchApi, SearchPage } from "./search-page.tsx";
import { defaultSearchPreferences, type SearchPreferences } from "./search-preferences.ts";
import { StatusPageSkeleton } from "./status-page-skeleton.tsx";

type SearchToolRestoreState =
  | { kind: "bulk"; selectedQueryId: string | null; value: string }
  | { kind: "text"; text: string };

interface BrowserLocation {
  pathname: string;
  search: string;
  state: Record<string, unknown>;
}

const markPath = /^\/marks\/(\d{8})$/;
const StatusPage = lazy(async () => {
  const module = await import("./operator-sync-page.tsx");
  return { default: module.StatusPage };
});

function AppearanceSync() {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyAppearance(savedAppearance(), media.matches);

    apply();
    media.addEventListener("change", apply);
    window.addEventListener(appearanceChangedEvent, apply);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener(appearanceChangedEvent, apply);
    };
  }, []);
  return null;
}

const publicStatusApi: PublicStatusApi = {
  async status() {
    const response = await fetch("/api/status");
    if (!response.ok) {
      throw new Error("Status unavailable");
    }
    return response.json();
  },
};

function StatusRoute({ operatorApi }: { operatorApi?: OperatorSyncApi }) {
  return (
    <Suspense
      fallback={
        <main
          aria-busy="true"
          className="page-shell page-start isolate min-h-[calc(100dvh-var(--topbar-height,4.5rem))]"
        >
          <h1 className="sr-only">Status</h1>
          <StatusPageSkeleton />
        </main>
      }
    >
      <StatusPage api={publicStatusApi} operatorApi={operatorApi} />
    </Suspense>
  );
}

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
  const accountApi = useMemo<AccountApi & AccountPreferencesApi>(
    () => ({
      create: (name) => client.account["api-keys"].create.mutate({ name }),
      getPreferences: () => client.account.preferences.get.query(),
      list: () => client.account["api-keys"].list.query(),
      revoke: (id) => client.account["api-keys"].revoke.mutate({ id }),
      updatePreferences: (preferences) => client.account.preferences.update.mutate(preferences),
    }),
    [client]
  );
  const [searchPreferences, setSearchPreferences] =
    useState<SearchPreferences>(defaultSearchPreferences);
  const [searchPreferencesLoading, setSearchPreferencesLoading] = useState(true);
  const [searchPreferencesError, setSearchPreferencesError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSearchPreferencesLoading(true);
    setSearchPreferencesError(null);
    accountApi
      .getPreferences()
      .then((preferences) => {
        if (active) {
          setSearchPreferences(preferences);
        }
      })
      .catch(() => {
        if (active) {
          setSearchPreferencesError("Search preferences could not be loaded.");
        }
      })
      .finally(() => {
        if (active) {
          setSearchPreferencesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [accountApi]);
  const updateSearchPreferences = useCallback(
    async (preferences: SearchPreferences) => {
      const saved = await accountApi.updatePreferences(preferences);
      setSearchPreferences(saved);
      setSearchPreferencesError(null);
      return saved;
    },
    [accountApi]
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
  const textCheckApi = useMemo<TextCheckApi>(
    () => ({
      match: (input) => client.marks.match.query(input),
    }),
    [client]
  );
  const bulkCheckApi = useMemo<BulkCheckApi>(
    () => ({
      screen: (input) => client.marks.screen.query(input),
      search: (input) => client.marks.search.query(input),
    }),
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
    if (location.state.tmterminalSearchEntry === true) {
      window.history.back();
    } else {
      setBrowserLocation("/search");
    }
  }, [location.state.tmterminalSearchEntry]);
  const handleSearchNavigate = useCallback((href: string, sourceSearch?: string) => {
    setBrowserLocation(href, {
      state: sourceSearch ? { searchReplacementSource: sourceSearch } : {},
    });
  }, []);
  const handleOpenMark = useCallback(
    (serialNumber: string, scrollOffset: number, restoreState?: SearchToolRestoreState) => {
      setBrowserLocation(`${location.pathname}${location.search}`, {
        replace: true,
        state: {
          ...location.state,
          searchScrollOffset: scrollOffset,
          searchToolRestore: restoreState,
        },
      });
      setBrowserLocation(`/marks/${serialNumber}`, { state: { tmterminalSearchEntry: true } });
      window.scrollTo(0, 0);
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
  const restoredSearchTool =
    location.state.searchToolRestore &&
    typeof location.state.searchToolRestore === "object" &&
    "kind" in location.state.searchToolRestore
      ? (location.state.searchToolRestore as SearchToolRestoreState)
      : undefined;
  let page: ReactNode;
  if (markRoute?.[1]) {
    page = <MarkDetailPage api={markApi} onBack={handleMarkBack} serialNumber={markRoute[1]} />;
  } else if (location.pathname === "/status") {
    page = <StatusRoute operatorApi={operator || import.meta.env.DEV ? operatorApi : undefined} />;
  } else if (location.pathname === "/help") {
    page = <HelpPage />;
  } else if (location.pathname === "/account") {
    page = (
      <AccountPage
        api={accountApi}
        onUpdatePreferences={updateSearchPreferences}
        preferences={searchPreferences}
        preferencesError={searchPreferencesError}
        preferencesLoading={searchPreferencesLoading}
      />
    );
  } else if (location.pathname === "/check") {
    page = (
      <CheckTextPage
        api={textCheckApi}
        initialState={restoredSearchTool?.kind === "text" ? restoredSearchTool : undefined}
        onNavigate={handleSearchNavigate}
        onOpenMark={handleOpenMark}
        preferences={searchPreferences}
        restoreScrollOffset={restoreScrollOffset}
      />
    );
  } else if (location.pathname === "/bulk") {
    page = (
      <BulkCheckPage
        api={bulkCheckApi}
        initialState={restoredSearchTool?.kind === "bulk" ? restoredSearchTool : undefined}
        onNavigate={handleSearchNavigate}
        onOpenMark={handleOpenMark}
        preferences={searchPreferences}
        restoreScrollOffset={restoreScrollOffset}
      />
    );
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
        preferences={searchPreferences}
        preferencesLoading={searchPreferencesLoading}
        replacementSourceSearch={replacementSourceSearch}
        restoreScrollOffset={restoreScrollOffset}
        search={location.search}
      />
    );
  }

  return (
    <>
      <TopBar pathname={location.pathname} />
      {page}
    </>
  );
}

const navItemClassName =
  "topbar-control hover:topbar-control-active inline-flex h-8 cursor-pointer items-center rounded-full border border-border px-3 font-medium text-foreground no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";

const activeNavItemClassName = "topbar-control-active border-transparent";

function TopBar({ pathname }: { pathname: string }) {
  const headerRef = useRef<HTMLElement>(null);
  const searchActive = pathname === "/" || ["/search", "/check", "/bulk"].includes(pathname);
  const navigate = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!plainPrimaryClick(event)) {
      return;
    }
    event.preventDefault();
    setBrowserLocation(event.currentTarget.getAttribute("href") ?? "/search");
    window.scrollTo(0, 0);
  }, []);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--topbar-height",
        `${header.getBoundingClientRect().height}px`
      );
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--topbar-height");
    };
  }, []);

  return (
    <header className="sticky top-0 z-30" ref={headerRef}>
      <div aria-hidden="true" className="topbar-scrim">
        <div />
        <div />
      </div>
      <div className="page-shell relative grid min-h-[4.5rem] grid-cols-[1fr_auto_auto] items-center py-3 max-[48rem]:grid-cols-[1fr_auto] max-[48rem]:gap-y-1">
        <a
          aria-label="Trademark Terminal home"
          className="inline-flex h-9 w-fit items-center gap-2 self-center justify-self-start rounded-[var(--radius)] bg-[#151616] pr-2 pl-2.5 no-underline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:border dark:border-border"
          href="/search"
          onClick={navigate}
        >
          <span className="font-[900] text-[#f5f2ea] text-[0.8125rem] leading-none tracking-[-0.02em]">
            TRADEMARK
          </span>
          <HugeiconsIcon
            aria-hidden="true"
            className="size-[1.15rem] text-primary"
            icon={ComputerTerminal01Icon}
            strokeWidth={2}
          />
        </a>
        <nav aria-label="Primary" className="hidden items-center gap-1.5 text-sm min-[48rem]:flex">
          <Show when="signed-in">
            <a
              aria-current={searchActive ? "page" : undefined}
              className={cn(navItemClassName, searchActive && activeNavItemClassName)}
              href="/search"
              onClick={navigate}
            >
              Search
            </a>
          </Show>
          <a
            aria-current={pathname === "/status" ? "page" : undefined}
            className={cn(navItemClassName, pathname === "/status" && activeNavItemClassName)}
            href="/status"
            onClick={navigate}
          >
            Status
          </a>
          <a
            aria-current={pathname === "/help" ? "page" : undefined}
            className={cn(navItemClassName, pathname === "/help" && activeNavItemClassName)}
            href="/help"
            onClick={navigate}
          >
            Help
          </a>
          <Show when="signed-in">
            <a
              aria-current={pathname === "/account" ? "page" : undefined}
              className={cn(navItemClassName, pathname === "/account" && activeNavItemClassName)}
              href="/account"
              onClick={navigate}
            >
              Account
            </a>
          </Show>
        </nav>
        <Show when="signed-in">
          <div className="ml-3.5 flex items-center gap-2 max-[48rem]:col-start-2 max-[48rem]:row-start-1 max-[48rem]:ml-2">
            <AccountMenu />
            <MobileNavMenu navigate={navigate} pathname={pathname} signedIn />
          </div>
        </Show>
        <Show when="signed-out">
          <div className="ml-3.5 flex items-center gap-2 max-[48rem]:col-start-2 max-[48rem]:row-start-1 max-[48rem]:ml-2">
            <SignInButton mode="modal">
              <Button className="pill-button">Sign in</Button>
            </SignInButton>
            <MobileNavMenu navigate={navigate} pathname={pathname} signedIn={false} />
          </div>
        </Show>
      </div>
    </header>
  );
}

function MobileNavMenu({
  navigate,
  pathname,
  signedIn,
}: {
  navigate: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
  pathname: string;
  signedIn: boolean;
}) {
  const currentItemClass = (current: boolean) => (current ? "bg-accent" : undefined);
  return (
    <Menu>
      <MenuTrigger
        aria-label="Menu"
        className="group min-[48rem]:hidden"
        render={
          <Button
            className="pill-button topbar-control hover:topbar-control-active border-border"
            size="icon"
            variant="ghost"
          />
        }
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="group-data-[popup-open]:hidden"
          icon={Menu01Icon}
        />
        <HugeiconsIcon
          aria-hidden="true"
          className="hidden group-data-[popup-open]:block"
          icon={Cancel01Icon}
        />
      </MenuTrigger>
      <MenuPopup align="end">
        {signedIn ? (
          <MenuLinkItem
            aria-current={
              pathname === "/" || ["/search", "/check", "/bulk"].includes(pathname)
                ? "page"
                : undefined
            }
            className={currentItemClass(
              pathname === "/" || ["/search", "/check", "/bulk"].includes(pathname)
            )}
            href="/search"
            onClick={navigate}
          >
            Search
          </MenuLinkItem>
        ) : null}
        <MenuLinkItem
          aria-current={pathname === "/status" ? "page" : undefined}
          className={currentItemClass(pathname === "/status")}
          href="/status"
          onClick={navigate}
        >
          Status
        </MenuLinkItem>
        <MenuLinkItem
          aria-current={pathname === "/help" ? "page" : undefined}
          className={currentItemClass(pathname === "/help")}
          href="/help"
          onClick={navigate}
        >
          Help
        </MenuLinkItem>
        {signedIn ? (
          <MenuLinkItem
            aria-current={pathname === "/account" ? "page" : undefined}
            className={currentItemClass(pathname === "/account")}
            href="/account"
            onClick={navigate}
          >
            Account
          </MenuLinkItem>
        ) : null}
      </MenuPopup>
    </Menu>
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
    <main className="page-shell isolate grid min-h-[calc(100dvh-var(--topbar-height,4.5rem))] content-center gap-8 py-[clamp(2rem,5vw,5.5rem)]">
      <p className="mb-0 font-[650] text-base">Trademark search for Print on Demand sellers.</p>
      <h1 className="display-masthead m-0 text-[clamp(2.75rem,12.5vw,14rem)]">
        TRADEMARK
        <br />
        TERMINAL
      </h1>
      <p className="m-0 max-w-[30rem] text-base">
        Sign in with your MerchBase account to run your search.
      </p>
      <form
        autoComplete="off"
        className="grid grid-cols-[minmax(0,1fr)_clamp(13rem,18vw,16rem)] gap-0 border border-border p-0 [--search-control-height:4.25rem] **:data-[slot=search-icon]:left-3 **:data-[slot=search-icon]:size-[1.15rem] **:data-[slot=input-control]:h-[var(--search-control-height)] **:data-[slot=input]:h-full *:data-[slot=button]:h-[var(--search-control-height)] *:data-[slot=button]:w-full **:data-[slot=input-control]:border-0 *:data-[slot=button]:border-0 *:data-[slot=button]:border-border *:data-[slot=button]:border-l **:data-[slot=input-control]:bg-transparent *:data-[slot=button]:px-[clamp(1.5rem,3vw,2.5rem)] **:data-[slot=input]:py-0 **:data-[slot=input]:pr-[clamp(1rem,2vw,1.5rem)] **:data-[slot=input]:pl-10 **:data-[slot=input]:font-semibold **:data-[slot=input]:text-xl *:data-[slot=button]:text-[clamp(1.125rem,1.5vw,1.4rem)] **:data-[slot=input]:leading-none **:data-[slot=input]:tracking-[-0.035em] **:data-[slot=input-control]:shadow-none *:data-[slot=button]:shadow-none max-[48rem]:grid-cols-[minmax(0,1fr)_7.5rem] has-[input:focus-visible]:[&>[data-slot=button]]:border-l-transparent [&_[data-slot=input-control]::before]:shadow-none"
        data-slot="trademark-search-form"
        onSubmit={handleSubmit}
      >
        <label className="sr-only" htmlFor="signed-out-search">
          Search trademarks
        </label>
        <div className="relative min-w-0 before:pointer-events-none before:absolute before:inset-0 before:z-20 before:border before:border-transparent before:content-[''] has-[input:focus-visible]:before:border-ring">
          <HugeiconsIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-[clamp(1rem,2vw,1.5rem)] z-10 size-[clamp(1.25rem,2vw,1.6rem)] -translate-y-1/2 text-muted-foreground"
            data-slot="search-icon"
            icon={Search01Icon}
          />
          <Input
            autoComplete="off"
            className="rounded-none before:rounded-none"
            id="signed-out-search"
            maxLength={200}
            name="query"
            onChange={handleChange}
            placeholder="Search a word mark"
            required
            size="lg"
            type="search"
            value={query}
          />
        </div>
        <Button className="rounded-none before:rounded-none" size="xl" type="submit">
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
  let signedOutPage: ReactNode = <SignedOutSearch search={location.search} />;
  if (location.pathname === "/status") {
    signedOutPage = <StatusRoute />;
  } else if (location.pathname === "/help") {
    signedOutPage = <HelpPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AppearanceSync />
      <Show when="signed-in">
        <SignedInApp location={location} />
      </Show>
      <Show when="signed-out">
        <TopBar pathname={location.pathname} />
        <DevAutoSignIn />
        {signedOutPage}
      </Show>
    </QueryClientProvider>
  );
}
