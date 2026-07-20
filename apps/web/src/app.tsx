import { Show, SignInButton, UserButton, useAuth, useClerk, useUser } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
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
import turtleLogo from "../../../assets/brand/turtle-mark.svg";
import type { AppRouter } from "../../server/src/api/router.ts";
import { type AccountApi, AccountPage } from "./account-page.tsx";
import { AppearanceMenu } from "./appearance-menu.tsx";
import { DevAutoSignIn } from "./dev-auto-sign-in.tsx";
import { HelpPage } from "./help-page.tsx";
import { type MarkApi, MarkDetailPage } from "./mark-detail-page.tsx";
import { type OperatorSyncApi, type PublicStatusApi, StatusPage } from "./operator-sync-page.tsx";
import { type ReportsApi, ReportsPage } from "./reports-page.tsx";
import { type SearchApi, SearchPage } from "./search-page.tsx";

interface BrowserLocation {
  pathname: string;
  search: string;
  state: Record<string, unknown>;
}

const markPath = /^\/marks\/(\d{8})$/;

const publicStatusApi: PublicStatusApi = {
  async status() {
    const response = await fetch("/api/status");
    if (!response.ok) {
      throw new Error("Status unavailable");
    }
    return response.json();
  },
};

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
  const { user } = useUser();
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
  } else if (location.pathname === "/status") {
    page = (
      <StatusPage
        api={publicStatusApi}
        operatorApi={operator || import.meta.env.DEV ? operatorApi : undefined}
      />
    );
  } else if (location.pathname === "/help") {
    page = <HelpPage />;
  } else if (location.pathname === "/account") {
    page = <AccountPage api={accountApi} email={user?.primaryEmailAddress?.emailAddress ?? null} />;
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
      <TopBar pathname={location.pathname} />
      {page}
    </>
  );
}

const navItemClassName =
  "inline-flex items-center text-inherit underline-offset-[0.3em] hover:underline";

function TopBar({ pathname }: { pathname: string }) {
  const headerRef = useRef<HTMLElement>(null);
  const navigate = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!plainPrimaryClick(event)) {
      return;
    }
    event.preventDefault();
    setBrowserLocation(event.currentTarget.getAttribute("href") ?? "/search");
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
    <header className="sticky top-0 z-30 border-border border-b bg-background" ref={headerRef}>
      <div className="page-shell grid min-h-[3.75rem] grid-cols-[1fr_auto_auto] items-center py-1.5 max-[48rem]:grid-cols-[1fr_auto] max-[48rem]:gap-y-1">
        <a
          aria-label="Trademark Turtle home"
          className="inline-flex h-12 w-16 items-center justify-center overflow-hidden bg-[#151616] no-underline"
          href="/search"
          onClick={navigate}
        >
          <img
            alt=""
            className="h-8 w-auto max-w-none"
            draggable={false}
            height="36"
            src={turtleLogo}
            width="52"
          />
        </a>
        <nav
          aria-label="Primary"
          className="flex items-center gap-3.5 text-base max-[48rem]:col-span-full max-[48rem]:row-start-2 max-[48rem]:w-full max-[48rem]:justify-start max-[48rem]:gap-x-4 max-[48rem]:gap-y-1 max-[48rem]:overflow-x-auto max-[48rem]:[&_a]:min-h-11 max-[48rem]:[&_a]:shrink-0 max-[48rem]:[&_button]:min-h-11 max-[48rem]:[&_button]:shrink-0"
        >
          <Show when="signed-in">
            <a
              aria-current={pathname === "/" || pathname === "/search" ? "page" : undefined}
              className={cn(
                navItemClassName,
                (pathname === "/" || pathname === "/search") && "underline"
              )}
              href="/search"
              onClick={navigate}
            >
              Search
            </a>
            <Menu>
              <MenuTrigger
                aria-current={pathname === "/reports" ? "page" : undefined}
                className={cn(
                  navItemClassName,
                  "border-0 bg-transparent p-0 font-inherit",
                  pathname === "/reports" && "underline"
                )}
              >
                Reports
              </MenuTrigger>
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
          </Show>
          <a
            aria-current={pathname === "/status" ? "page" : undefined}
            className={cn(navItemClassName, pathname === "/status" && "underline")}
            href="/status"
            onClick={navigate}
          >
            Status
          </a>
          <a
            aria-current={pathname === "/help" ? "page" : undefined}
            className={cn(navItemClassName, pathname === "/help" && "underline")}
            href="/help"
            onClick={navigate}
          >
            Help
          </a>
          <Show when="signed-in">
            <a
              aria-current={pathname === "/account" ? "page" : undefined}
              className={cn(navItemClassName, pathname === "/account" && "underline")}
              href="/account"
              onClick={navigate}
            >
              Account
            </a>
          </Show>
        </nav>
        <Show when="signed-in">
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
      </div>
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
    <main className="page-shell isolate grid min-h-[calc(100dvh-3.75rem)] content-center gap-8 py-[clamp(2rem,5vw,5.5rem)]">
      <p className="mb-0 font-[650] text-base">Trademark search for Print on Demand sellers.</p>
      <h1 className="m-0 font-black text-[clamp(2.75rem,12.5vw,14rem)] leading-[0.78] tracking-[-0.055em]">
        TRADEMARK
        <br />
        TURTLE
      </h1>
      <p className="m-0 max-w-[30rem] text-base">
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
  let signedOutPage: ReactNode = <SignedOutSearch search={location.search} />;
  if (location.pathname === "/status") {
    signedOutPage = <StatusPage api={publicStatusApi} />;
  } else if (location.pathname === "/help") {
    signedOutPage = <HelpPage />;
  }

  return (
    <QueryClientProvider client={queryClient}>
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
