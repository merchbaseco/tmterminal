import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons-pro/core-stroke-rounded";
import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AppRouter } from "../../server/src/api/router.ts";
import { LegalFooter } from "./legal-footer.tsx";
import { SearchComposer, SearchMasthead } from "./search-composer.tsx";
import { SearchOptionSelect } from "./search-option-select.tsx";
import { defaultSearchPreferences, type SearchPreferences } from "./search-preferences.ts";
import {
  TrademarkResultRow,
  TrademarkResultSummary,
  TrademarkSearchEmptyState,
} from "./trademark-results.tsx";
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
const countFormatter = new Intl.NumberFormat("en-US");
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

function readSearchState(search: string, preferences: SearchPreferences): SearchState {
  const parameters = new URLSearchParams(search);
  const exactDefault = preferences.defaultMatch !== "partial";
  const partialDefault = preferences.defaultMatch !== "exact";
  const exact = parameters.has("exact") ? parameters.get("exact") !== "false" : exactDefault;
  const partial = parameters.has("partial")
    ? parameters.get("partial") !== "false"
    : partialDefault;
  const registered = parameters.get("registered");
  const sort = parameters.get("sort");
  const status = parameters.get("status");
  const type = parameters.get("type");
  return {
    exact,
    partial: exact || partial ? partial : true,
    query: parameters.get("q")?.trim() ?? "",
    registered:
      registered === "all" || registered === "yes" || registered === "no"
        ? registered
        : preferences.defaultRegistered,
    sort:
      sort === "relevance" || sort === "newest-activity" || sort === "oldest-activity"
        ? sort
        : preferences.defaultSort,
    status:
      status === "all" || status === "live" || status === "dead"
        ? status
        : preferences.defaultStatus,
    type:
      type === "all" || type === "design" || type === "typeset" || type === "text"
        ? type
        : preferences.defaultType,
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

function requestFor(state: SearchState, pageSize: SearchPreferences["pageSize"]) {
  return {
    limit: pageSize,
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
  preferences = defaultSearchPreferences,
  preferencesLoading = false,
  replacementSourceSearch,
  restoreScrollOffset,
  search,
}: {
  api: SearchApi;
  onNavigate: (href: string, replacementSourceSearch?: string) => void;
  onOpenMark: (serialNumber: string, scrollOffset: number) => void;
  onReplacementLoaded: () => void;
  preferences?: SearchPreferences;
  preferencesLoading?: boolean;
  replacementSourceSearch?: string;
  restoreScrollOffset: number;
  search: string;
}) {
  const state = useMemo(() => readSearchState(search, preferences), [preferences, search]);
  const [draftQuery, setDraftQuery] = useState(state.query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pendingQuery = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const resultsRef = useRef<HTMLOListElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const restoredEntry = useRef<string | null>(null);

  useEffect(() => setDraftQuery(state.query), [state.query]);

  const request = useMemo(
    () => requestFor(state, preferences.pageSize),
    [preferences.pageSize, state]
  );
  const queryKey = useMemo(() => ["marks.search", request] as const, [request]);
  const sourceState = useMemo(() => {
    if (!(state.query && replacementSourceSearch) || replacementSourceSearch === search) {
      return null;
    }
    const source = readSearchState(replacementSourceSearch, preferences);
    return source.query ? source : null;
  }, [preferences, replacementSourceSearch, search, state.query]);
  const sourceQueryKey = useMemo(
    () =>
      sourceState
        ? (["marks.search", requestFor(sourceState, preferences.pageSize)] as const)
        : null,
    [preferences.pageSize, sourceState]
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
    estimateSize: () => (preferences.resultDensity === "compact" ? 84 : 100),
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
      "calc(var(--topbar-height, 4.5rem) + 7.5rem)"
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

  const updateState = useCallback(
    (patch: Partial<SearchState>) => {
      let sourceSearch: string | undefined;
      if (sourceData && !destinationData) {
        sourceSearch = replacementSourceSearch;
      } else if (destinationData && (!query.error || conflict)) {
        sourceSearch = search;
      }
      onNavigate(searchHref({ ...state, ...patch }), sourceSearch);
    },
    [
      conflict,
      destinationData,
      onNavigate,
      query.error,
      replacementSourceSearch,
      search,
      sourceData,
      state,
    ]
  );

  const submitQuery = useCallback(
    (queryValue: string) => {
      if (queryValue === state.query) {
        queryClient.resetQueries({ exact: true, queryKey });
      } else {
        updateState({ query: queryValue });
      }
    },
    [queryClient, queryKey, state.query, updateState]
  );

  useEffect(() => {
    if (preferencesLoading || !pendingQuery.current) {
      return;
    }
    const queryValue = pendingQuery.current;
    pendingQuery.current = null;
    submitQuery(queryValue);
  }, [preferencesLoading, submitQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queryValue = draftQuery.trim();
    if (!queryValue) {
      return;
    }
    if (preferencesLoading) {
      pendingQuery.current = queryValue;
      return;
    }
    submitQuery(queryValue);
  }

  function startOver() {
    onNavigate("/search");
    window.scrollTo(0, 0);
  }

  const total = data?.pages[0]?.total ?? 0;

  return (
    <main
      className={cn(
        "page-shell isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col [--search-side-column:clamp(13rem,18vw,16rem)]",
        !state.query && "page-start"
      )}
    >
      {state.query ? (
        <h1 className="sr-only">Trademark search results for “{state.query}”</h1>
      ) : (
        <SearchMasthead />
      )}

      <div
        className={cn(
          state.query
            ? "page-start sticky top-[var(--topbar-height,4.5rem)] z-10 bg-background"
            : "pt-[clamp(1.5rem,4vw,3.5rem)] pb-5"
        )}
      >
        <SearchComposer
          actionLabel="Search"
          activeTool="marks"
          fieldLabel="Search trademarks"
          invalidActionLabel={draftQuery.trim() ? undefined : "Give me a word"}
          maxLength={200}
          name="query"
          onNavigate={onNavigate}
          onStartOver={state.query ? startOver : undefined}
          // biome-ignore lint/performance/noJsxPropsBind: The local submit handler reads URL-owned search state.
          onSubmit={submit}
          onValueChange={setDraftQuery}
          placeholder="Search a word mark"
          startOverLabel={state.query ? "Start a new search" : undefined}
          value={draftQuery}
        />

        {state.query ? (
          <Button
            aria-controls="search-options"
            aria-expanded={filtersOpen}
            className="pill-button mb-3 hidden w-full max-[48rem]:inline-flex"
            // biome-ignore lint/performance/noJsxPropsBind: This mobile disclosure owns one local boolean.
            onClick={() => setFiltersOpen((open) => !open)}
            variant="outline"
          >
            Filters and sort
            <HugeiconsIcon
              aria-hidden="true"
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-[120ms] ease-out",
                filtersOpen && "rotate-180"
              )}
              icon={ArrowDown01Icon}
            />
          </Button>
        ) : null}
        <section
          aria-label="Search options"
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_var(--search-side-column)] items-stretch border border-border border-t-0 max-[48rem]:hidden max-[48rem]:grid-cols-2 min-[48rem]:[&_[name=sort]]:border-l",
            filtersOpen && "max-[48rem]:grid"
          )}
          hidden={!state.query}
          id="search-options"
        >
          <div className="grid min-w-0 grid-cols-[minmax(14rem,1.4fr)_repeat(3,minmax(7rem,1fr))] max-[48rem]:contents min-[48rem]:[&_[name=registered]]:border-r-0">
            {/* biome-ignore lint/a11y/useSemanticElements: A native fieldset legend sits off-grid and breaks the shared filter baseline. */}
            <div
              aria-labelledby="search-match-label"
              className="grid min-h-16 grid-cols-[auto_auto] content-center justify-start gap-x-4 gap-y-1 border-0 border-border border-r px-4 py-3 max-[48rem]:col-span-full max-[48rem]:border-r-0 max-[48rem]:border-b [&_input]:accent-primary [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_label]:font-semibold [&_label]:text-base"
              role="group"
            >
              <span
                className="utility-label col-span-full text-muted-foreground"
                id="search-match-label"
              >
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
          </div>
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
        <p className="m-0 border-border border-x border-b px-4 py-12 text-base">
          Searching Class 025…
        </p>
      ) : null}
      {query.error ? (
        <div className="flex items-center justify-between gap-4 border-border border-x border-b px-4">
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
              className="pill-button"
              // biome-ignore lint/performance/noJsxPropsBind: Retry resets this page's exact query key.
              onClick={() => queryClient.resetQueries({ exact: true, queryKey })}
              variant="outline"
            >
              Run search again
            </Button>
          ) : null}
        </div>
      ) : null}
      {data && !(query.error || query.isPlaceholderData) && total === 0 ? (
        <section aria-label="Search results" className="border-border border-x">
          <TrademarkResultSummary
            signals={[
              {
                label: "Live exact",
                value: countFormatter.format(data.pages[0]?.liveMatchCounts.exact ?? 0),
              },
              {
                label: "Live partial",
                value: countFormatter.format(data.pages[0]?.liveMatchCounts.partial ?? 0),
              },
            ]}
            totalLabel="0 results"
          />
          <TrademarkSearchEmptyState query={state.query} />
        </section>
      ) : null}

      {data && total > 0 && (!query.error || conflict || replacementFailure) ? (
        <section aria-label="Search results" className="border-border border-x">
          <TrademarkResultSummary
            signals={[
              {
                label: "Live exact",
                value: countFormatter.format(data.pages[0]?.liveMatchCounts.exact ?? 0),
              },
              {
                label: "Live partial",
                value: countFormatter.format(data.pages[0]?.liveMatchCounts.partial ?? 0),
              },
            ]}
            totalLabel={`${countFormatter.format(total)} ${total === 1 ? "result" : "results"}`}
          />
          <div key={restorationKey}>
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
                  <TrademarkResultRow
                    contextLabel={matchLabels[item.match]}
                    density={preferences.resultDensity}
                    item={item}
                    key={item.serialNumber}
                    onOpen={onOpenMark}
                    position={{
                      index: virtualRow.index,
                      measureElement: virtualizer.measureElement,
                      scrollMargin: virtualizer.options.scrollMargin,
                      start: virtualRow.start,
                    }}
                    total={total}
                  />
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
            <p className="m-0 border-border border-b px-4 py-12 text-base">Loading more results…</p>
          ) : null}
        </section>
      ) : null}
      <LegalFooter />
    </main>
  );
}
