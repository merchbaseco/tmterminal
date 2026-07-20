import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AppRouter } from "../../server/src/api/router.ts";
import { MarkResultContent } from "./mark-result-content.tsx";
import { SearchOptionSelect } from "./search-option-select.tsx";
import { trpcErrorCode } from "./trpc-error-code.ts";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SearchInput = RouterInputs["marks"]["search"];
type SearchPageResult = RouterOutputs["marks"]["search"];
interface SearchPageParam {
  expectedDataVersion?: string;
  offset: number;
}

export interface SearchApi {
  search: (input: SearchInput) => Promise<SearchPageResult>;
}

interface SearchState {
  exact: boolean;
  partial: boolean;
  query: string;
  registered: "all" | "yes" | "no";
  sort: "relevance" | "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text";
}

const matchLabels = { exact: "", partial: "Partial" } as const;
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

function readSearchState(search: string): SearchState {
  const parameters = new URLSearchParams(search);
  const exact = parameters.get("exact") !== "false";
  const partial = parameters.get("partial") !== "false";
  const registered = parameters.get("registered");
  const sort = parameters.get("sort");
  const status = parameters.get("status");
  const type = parameters.get("type");
  return {
    exact,
    partial: exact || partial ? partial : true,
    query: parameters.get("q")?.trim() ?? "",
    registered: registered === "yes" || registered === "no" ? registered : "all",
    sort: sort === "newest-activity" || sort === "oldest-activity" ? sort : "relevance",
    status: status === "live" || status === "dead" ? status : "all",
    type: type === "design" || type === "typeset" || type === "text" ? type : "all",
  };
}

function searchHref(state: SearchState) {
  const parameters = new URLSearchParams({
    exact: String(state.exact),
    mode: "multi",
    partial: String(state.partial),
    q: state.query,
    registered: state.registered,
    sort: state.sort,
    status: state.status,
    type: state.type,
  });
  return `/search?${parameters.toString()}`;
}

function matchFor(state: SearchState): "exact" | "partial" | "both" {
  if (state.exact && state.partial) {
    return "both";
  }
  return state.exact ? "exact" : "partial";
}

function requestFor(state: SearchState) {
  return {
    limit: 25 as const,
    match: matchFor(state),
    mode: "multi" as const,
    query: state.query,
    registered: state.registered,
    sort: state.sort,
    status: state.status,
    type: state.type,
  };
}

function searchErrorMessage(code: string | null, conflict: boolean, replacementFailure: boolean) {
  if (conflict) {
    return "Trademark data changed. Run the search again before continuing.";
  }
  if (replacementFailure) {
    return "New search could not be loaded. Previous results are still shown.";
  }
  if (code === "SERVICE_UNAVAILABLE" || code === "UPSTREAM_UNAVAILABLE") {
    return "Search is temporarily unavailable. Try again shortly.";
  }
  return "Search could not be loaded.";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Search query, restoration, and navigation state deliberately share one owner.
export function SearchPage({
  api,
  onNavigate,
  onOpenMark,
  onReplacementLoaded,
  replacementSourceSearch,
  restoreScrollOffset,
  search,
}: {
  api: SearchApi;
  onNavigate: (href: string, replacementSourceSearch?: string) => void;
  onOpenMark: (serialNumber: string, scrollOffset: number) => void;
  onReplacementLoaded: () => void;
  replacementSourceSearch?: string;
  restoreScrollOffset: number;
  search: string;
}) {
  const state = useMemo(() => readSearchState(search), [search]);
  const [draftQuery, setDraftQuery] = useState(state.query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const queryClient = useQueryClient();
  const resultsRef = useRef<HTMLOListElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const restoredEntry = useRef<string | null>(null);

  useEffect(() => setDraftQuery(state.query), [state.query]);

  const request = useMemo(() => requestFor(state), [state]);
  const queryKey = useMemo(() => ["marks.search", request] as const, [request]);
  const sourceState = useMemo(() => {
    if (!(state.query && replacementSourceSearch) || replacementSourceSearch === search) {
      return null;
    }
    const source = readSearchState(replacementSourceSearch);
    return source.query ? source : null;
  }, [replacementSourceSearch, search, state.query]);
  const sourceQueryKey = useMemo(
    () => (sourceState ? (["marks.search", requestFor(sourceState)] as const) : null),
    [sourceState]
  );
  const sourceQueryState = sourceQueryKey ? queryClient.getQueryState(sourceQueryKey) : undefined;
  const sourceError = sourceQueryState?.error instanceof Error ? sourceQueryState.error : null;
  const sourceData =
    sourceQueryKey && (!sourceError || trpcErrorCode(sourceError) === "CONFLICT")
      ? queryClient.getQueryData<InfiniteData<SearchPageResult, SearchPageParam>>(sourceQueryKey)
      : undefined;
  const destinationData =
    queryClient.getQueryData<InfiniteData<SearchPageResult, SearchPageParam>>(queryKey);
  const restorationKey = `${search}\n${restoreScrollOffset}`;
  const query = useInfiniteQuery<
    SearchPageResult,
    Error,
    InfiniteData<SearchPageResult, SearchPageParam>,
    typeof queryKey,
    SearchPageParam
  >({
    enabled: state.query.length > 0,
    gcTime: Number.POSITIVE_INFINITY,
    getNextPageParam: (lastPage, pages) => {
      const offset = pages.reduce((sum, page) => sum + page.items.length, 0);
      return offset < lastPage.total
        ? { expectedDataVersion: pages[0]?.meta.dataVersion, offset }
        : undefined;
    },
    initialPageParam: { expectedDataVersion: undefined as string | undefined, offset: 0 },
    placeholderData: () => sourceData,
    queryFn: ({ pageParam }) =>
      api.search({
        ...request,
        ...(pageParam.expectedDataVersion
          ? { expectedDataVersion: pageParam.expectedDataVersion }
          : {}),
        offset: pageParam.offset,
      }),
    queryKey,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const conflict = trpcErrorCode(query.error) === "CONFLICT";
  const replacementFailure = Boolean(query.error && sourceData && !destinationData && !conflict);
  const expectedUnavailable =
    !(conflict || replacementFailure) &&
    ["SERVICE_UNAVAILABLE", "UPSTREAM_UNAVAILABLE"].includes(trpcErrorCode(query.error) ?? "");
  const data = query.data ?? (replacementFailure ? sourceData : undefined);
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 72,
    getItemKey: (index) => items[index]?.serialNumber ?? index,
    initialRect: { height: 640, width: 1200 },
    overscan: 3,
    scrollMargin: resultsRef.current?.offsetTop ?? 0,
    useFlushSync: false,
  });

  useLayoutEffect(() => {
    if (restoredEntry.current === restorationKey || !data) {
      return;
    }
    restoredEntry.current = restorationKey;
    window.scrollTo(0, restoreScrollOffset);
  }, [data, restorationKey, restoreScrollOffset]);

  useLayoutEffect(() => {
    if (!state.query) {
      return;
    }
    document.documentElement.style.setProperty(
      "--page-scroll-padding",
      "calc(var(--topbar-height, 3.75rem) + 7.5rem)"
    );
    return () => {
      document.documentElement.style.removeProperty("--page-scroll-padding");
    };
  }, [state.query]);

  useEffect(() => {
    if (replacementSourceSearch && query.data?.pages[0]?.offset === 0 && !query.isPlaceholderData) {
      onReplacementLoaded();
    }
  }, [onReplacementLoaded, query.data, query.isPlaceholderData, replacementSourceSearch]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!(target && query.hasNextPage) || query.error) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !query.isFetchingNextPage) {
          query.fetchNextPage();
        }
      },
      { rootMargin: "500px 0px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [query.error, query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  function updateState(patch: Partial<SearchState>) {
    let sourceSearch: string | undefined;
    if (sourceData && !destinationData) {
      sourceSearch = replacementSourceSearch;
    } else if (destinationData && (!query.error || conflict)) {
      sourceSearch = search;
    }
    onNavigate(searchHref({ ...state, ...patch }), sourceSearch);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queryValue = draftQuery.trim();
    if (!queryValue) {
      return;
    }
    if (queryValue === state.query) {
      queryClient.resetQueries({ exact: true, queryKey });
    } else {
      updateState({ query: queryValue });
    }
  }

  const total = data?.pages[0]?.total ?? 0;

  return (
    <main
      className={cn(
        "page-shell isolate flex min-h-[calc(100dvh-3.75rem)] flex-col pt-[clamp(1.25rem,2vw,2rem)]",
        state.query && "pt-0"
      )}
    >
      {state.query ? (
        <h1 className="sr-only">Trademark search results for “{state.query}”</h1>
      ) : (
        <header className="border-border border-b pb-[clamp(1.5rem,4vw,3rem)]">
          <p className="mb-4 font-[650] text-base">Trademark search for Print on Demand sellers.</p>
          <h1 className="m-0 max-w-[10ch] font-black text-[clamp(2.75rem,min(12.5vw,18dvh),14rem)] leading-[0.78] tracking-[-0.055em]">
            TRADEMARK
            <br />
            TURTLE
          </h1>
        </header>
      )}

      <div
        className={cn(
          state.query && "sticky top-[var(--topbar-height,3.75rem)] z-10 bg-background pt-4"
        )}
      >
        <form
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-0 pt-[clamp(1.5rem,4vw,3.5rem)] pb-5 [--search-control-height:clamp(3.5rem,7vw,5.5rem)] max-[48rem]:grid-cols-1 [&>[data-slot=button]]:h-[var(--search-control-height)] [&>[data-slot=button]]:px-[clamp(1.5rem,3vw,2.5rem)] [&>[data-slot=button]]:text-[clamp(1.125rem,1.5vw,1.4rem)] [&_[data-slot=input-control]]:h-[var(--search-control-height)] [&_[data-slot=input-control]]:rounded-[var(--radius)] [&_[data-slot=input]]:h-full [&_[data-slot=input]]:px-[clamp(1rem,2vw,1.5rem)] [&_[data-slot=input]]:py-0 [&_[data-slot=input]]:font-semibold [&_[data-slot=input]]:text-[clamp(1.25rem,3vw,2.4rem)] [&_[data-slot=input]]:leading-none [&_[data-slot=input]]:tracking-[-0.035em]",
            state.query &&
              "pt-1 pb-3 [--search-control-height:2.75rem] [&_[data-slot=input]]:text-xl"
          )}
          // biome-ignore lint/performance/noJsxPropsBind: The local submit handler reads this page's draft query.
          onSubmit={submit}
        >
          <label className="sr-only" htmlFor="trademark-search">
            Search trademarks
          </label>
          <Input
            id="trademark-search"
            maxLength={200}
            name="query"
            // biome-ignore lint/performance/noJsxPropsBind: This local input directly owns the draft query.
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="Search a word mark"
            required
            size="lg"
            type="search"
            value={draftQuery}
          />
          <Button size="xl" type="submit">
            Search
          </Button>
        </form>

        {state.query ? (
          <Button
            aria-controls="search-options"
            aria-expanded={filtersOpen}
            className="mb-3 hidden w-full max-[48rem]:inline-flex"
            // biome-ignore lint/performance/noJsxPropsBind: This mobile disclosure owns one local boolean.
            onClick={() => setFiltersOpen((open) => !open)}
            variant="outline"
          >
            Filters and sort
          </Button>
        ) : null}
        <section
          aria-label="Search options"
          className={cn(
            "flex flex-wrap items-end border-border border-y max-[48rem]:hidden max-[48rem]:grid-cols-2 max-[48rem]:items-stretch",
            filtersOpen && "max-[48rem]:grid"
          )}
          hidden={!state.query}
          id="search-options"
        >
          {/* biome-ignore lint/a11y/useSemanticElements: A native fieldset legend sits off-grid and breaks the shared filter baseline. */}
          <div
            aria-labelledby="search-match-label"
            className="flex min-h-11 flex-nowrap items-center gap-[0.65rem] border-0 border-border border-r px-4 py-[0.45rem] font-[650] text-[0.75rem] uppercase tracking-[0.09em] max-[48rem]:col-span-full max-[48rem]:grid max-[48rem]:min-h-14 max-[48rem]:grid-cols-[auto_auto] max-[48rem]:content-start max-[48rem]:border-r-0 max-[48rem]:border-b max-[48rem]:px-4 max-[48rem]:py-3 [&_input]:accent-primary [&_label]:flex [&_label]:items-center [&_label]:gap-[0.4rem]"
            role="group"
          >
            <span className="max-[48rem]:col-span-full" id="search-match-label">
              Match
            </span>
            <label>
              <input
                checked={state.exact}
                disabled={state.exact && !state.partial}
                name="exact"
                // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
                onChange={(event) => updateState({ exact: event.target.checked })}
                type="checkbox"
              />
              Exact
            </label>
            <label>
              <input
                checked={state.partial}
                disabled={state.partial && !state.exact}
                name="partial"
                // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
                onChange={(event) => updateState({ partial: event.target.checked })}
                type="checkbox"
              />
              Partial
            </label>
          </div>
          <SearchOptionSelect
            label="Status"
            name="status"
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onValueChange={(status) => updateState({ status })}
            options={statusOptions}
            value={state.status}
          />
          <SearchOptionSelect
            label="Type"
            name="type"
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onValueChange={(type) => updateState({ type })}
            options={typeOptions}
            value={state.type}
          />
          <SearchOptionSelect
            label="Registered"
            name="registered"
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onValueChange={(registered) => updateState({ registered })}
            options={registeredOptions}
            value={state.registered}
          />
          <SearchOptionSelect
            label="Sort"
            name="sort"
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onValueChange={(sort) => updateState({ sort })}
            options={sortOptions}
            value={state.sort}
          />
        </section>
      </div>

      {query.isPending && state.query ? (
        <p className="m-0 border-border border-b py-12 text-base">Searching Class 025…</p>
      ) : null}
      {query.error ? (
        <div className="flex items-center justify-between gap-4 border-border border-b">
          <p
            className={cn(
              "m-0 py-8 text-destructive-foreground",
              expectedUnavailable && "py-4 text-foreground"
            )}
            role="alert"
          >
            {searchErrorMessage(trpcErrorCode(query.error), conflict, replacementFailure)}
          </p>
          {conflict ? (
            <Button
              // biome-ignore lint/performance/noJsxPropsBind: Retry resets this page's exact query key.
              onClick={() => queryClient.resetQueries({ exact: true, queryKey })}
              variant="outline"
            >
              Run search again
            </Button>
          ) : null}
        </div>
      ) : null}
      {data && !query.error && total === 0 ? (
        <div className="flex items-center justify-between border-border border-b py-12">
          <p className="m-0 text-base">No matching marks</p>
          <Button
            // biome-ignore lint/performance/noJsxPropsBind: The empty state clears this page's URL-owned filters.
            onClick={() =>
              updateState({
                exact: true,
                partial: true,
                registered: "all",
                sort: "relevance",
                status: "all",
                type: "all",
              })
            }
            variant="outline"
          >
            Clear filters
          </Button>
        </div>
      ) : null}

      {data && total > 0 && (!query.error || conflict || replacementFailure) ? (
        <section aria-label="Search results">
          <div className="flex min-h-10 items-center font-[650] text-[0.75rem] uppercase tracking-[0.09em] [&_p]:m-0">
            <p className="flex flex-wrap gap-x-[0.6rem] gap-y-1 [&>span+span]:font-extrabold [&>span+span]:before:mr-[0.6rem] [&>span+span]:before:text-muted-foreground [&>span+span]:before:content-['·']">
              <span>
                {total} {total === 1 ? "result" : "results"}
              </span>
              <span>{data.pages[0]?.liveMatchCounts.exact ?? 0} live exact</span>
              <span>{data.pages[0]?.liveMatchCounts.partial ?? 0} live partial</span>
            </p>
          </div>
          <div className="border-border border-y" key={restorationKey}>
            <ol
              aria-label="Trademark results"
              className="relative m-0 w-full list-none p-0"
              ref={resultsRef}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) {
                  return null;
                }
                return (
                  <li
                    aria-posinset={virtualRow.index + 1}
                    aria-setsize={total}
                    className="absolute top-0 left-0 isolate grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-8 border-border border-b py-2 has-[a:hover]:bg-accent max-[48rem]:min-h-20 max-[48rem]:gap-4 max-[48rem]:py-2.5"
                    data-index={virtualRow.index}
                    data-testid="search-result-row"
                    key={item.serialNumber}
                    ref={virtualizer.measureElement}
                    style={{
                      transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
                    }}
                  >
                    <MarkResultContent
                      contextLabel={matchLabels[item.match]}
                      item={item}
                      onOpen={onOpenMark}
                    />
                  </li>
                );
              })}
              <div
                aria-hidden="true"
                className="absolute top-0 left-0 h-px w-full"
                ref={loadMoreRef}
                style={{
                  transform: `translateY(${Math.max(virtualizer.getTotalSize() - 1, 0)}px)`,
                }}
              />
            </ol>
          </div>
          {query.isFetchingNextPage ? (
            <p className="m-0 border-border border-b py-12 text-base">Loading more results…</p>
          ) : null}
        </section>
      ) : null}
      <footer className="relative left-1/2 mt-auto w-dvw -translate-x-1/2 border-border border-t text-muted-foreground/70">
        <p className="page-shell my-0 py-8">
          Trademark data is informational, not legal advice. Verify critical decisions with the
          USPTO or qualified counsel.
        </p>
      </footer>
    </main>
  );
}
