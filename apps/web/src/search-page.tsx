import { type InfiniteData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppRouter } from "../../server/src/api/router.ts";
import { MarkResultContent } from "./mark-result-content.tsx";
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

const matchLabels = { exact: "Exact match", partial: "Partial match" } as const;

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
    return "Search is temporarily unavailable. Check Corpus freshness and try again.";
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
  const resultsRef = useRef<HTMLDivElement>(null);
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
    estimateSize: () => 168,
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
    <main className={state.query ? "search-shell search-shell-results" : "search-shell"}>
      <header className="search-heading">
        <p className="eyebrow">United States trademarks / Class 025</p>
        <h1>
          TRADEMARK
          <br />
          TURTLE
        </h1>
      </header>

      {/* biome-ignore lint/performance/noJsxPropsBind: The local submit handler reads this page's draft query. */}
      <form className="search-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="trademark-search">
          Search trademarks
        </label>
        <Input
          id="trademark-search"
          maxLength={200}
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

      <Button
        aria-controls="search-options"
        aria-expanded={filtersOpen}
        className="search-filter-toggle"
        // biome-ignore lint/performance/noJsxPropsBind: This mobile disclosure owns one local boolean.
        onClick={() => setFiltersOpen((open) => !open)}
        variant="outline"
      >
        Filters and sort
      </Button>
      <section
        aria-label="Search options"
        className={filtersOpen ? "search-options search-options-open" : "search-options"}
        id="search-options"
      >
        <fieldset>
          <legend>Match</legend>
          <label>
            <input
              checked={state.exact}
              disabled={state.exact && !state.partial}
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
              // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
              onChange={(event) => updateState({ partial: event.target.checked })}
              type="checkbox"
            />
            Partial
          </label>
        </fieldset>
        <label>
          Status
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onChange={(event) =>
              updateState({ status: event.target.value as SearchState["status"] })
            }
            value={state.status}
          >
            <option value="all">All</option>
            <option value="live">Live</option>
            <option value="dead">Dead</option>
          </select>
        </label>
        <label>
          Type
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onChange={(event) => updateState({ type: event.target.value as SearchState["type"] })}
            value={state.type}
          >
            <option value="all">All</option>
            <option value="design">Design</option>
            <option value="typeset">Typeset</option>
            <option value="text">Text</option>
          </select>
        </label>
        <label>
          Registered
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onChange={(event) =>
              updateState({ registered: event.target.value as SearchState["registered"] })
            }
            value={state.registered}
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Sort
          <select
            // biome-ignore lint/performance/noJsxPropsBind: Search option handlers are local leaf callbacks.
            onChange={(event) => updateState({ sort: event.target.value as SearchState["sort"] })}
            value={state.sort}
          >
            <option value="relevance">Relevance</option>
            <option value="newest-activity">Newest activity</option>
            <option value="oldest-activity">Oldest activity</option>
          </select>
        </label>
      </section>

      {state.query ? null : (
        <p className="search-prompt">Search live and dead Class 025 word marks.</p>
      )}
      {query.isPending && state.query ? (
        <p className="search-message">Searching Class 025…</p>
      ) : null}
      {query.error ? (
        <div className="search-error">
          <p className={expectedUnavailable ? "search-unavailable" : "error-message"} role="alert">
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
        <div className="search-empty">
          <p>No matching marks</p>
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
        <section aria-label="Search results" className="search-results">
          <div className="results-rule">
            <p>
              {total} {total === 1 ? "result" : "results"}
            </p>
            <p>
              {data.pages[0]?.meta.dataThroughDate
                ? `Data through ${data.pages[0].meta.dataThroughDate}`
                : "Data sync active"}
            </p>
          </div>
          <div className="search-results-list" key={restorationKey}>
            <div
              className="search-results-size"
              ref={resultsRef}
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) {
                  return null;
                }
                return (
                  <article
                    className="search-result-row"
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
                  </article>
                );
              })}
              <div
                aria-hidden="true"
                className="load-more-sentinel"
                ref={loadMoreRef}
                style={{
                  transform: `translateY(${Math.max(virtualizer.getTotalSize() - 1, 0)}px)`,
                }}
              />
            </div>
          </div>
          {query.isFetchingNextPage ? (
            <p className="search-message">Loading more results…</p>
          ) : null}
        </section>
      ) : null}
      <footer className="legal-disclaimer">
        Trademark data is informational, not legal advice. Verify critical decisions with the USPTO
        or qualified counsel.
      </footer>
    </main>
  );
}
