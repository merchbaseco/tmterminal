import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { AppRouter } from "../../server/src/api/router.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SearchInput = RouterInputs["marks"]["search"];
type SearchPageResult = RouterOutputs["marks"]["search"];
type SearchPageParam = { expectedCorpusVersion?: string; offset: number };

export type SearchApi = {
  search(input: SearchInput): Promise<SearchPageResult>;
};

type SearchState = {
  exact: boolean;
  partial: boolean;
  query: string;
  registered: "all" | "yes" | "no";
  sort: "relevance" | "newest-activity" | "oldest-activity";
  status: "all" | "live" | "dead";
  type: "all" | "design" | "typeset" | "text";
};

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

function errorCode(error: Error | null) {
  if (!error || !("data" in error) || !error.data || typeof error.data !== "object") return null;
  return "code" in error.data && typeof error.data.code === "string" ? error.data.code : null;
}

function matchFor(state: SearchState): "exact" | "partial" | "both" {
  if (state.exact && state.partial) return "both";
  return state.exact ? "exact" : "partial";
}

function requestFor(state: SearchState) {
  return {
    classes: ["025"],
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
  onNavigate(href: string, replacementSourceSearch?: string): void;
  onOpenMark(serialNumber: string, scrollOffset: number): void;
  onReplacementLoaded(): void;
  replacementSourceSearch?: string;
  restoreScrollOffset: number;
  search: string;
}) {
  const state = useMemo(() => readSearchState(search), [search]);
  const [draftQuery, setDraftQuery] = useState(state.query);
  const queryClient = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const restoredEntry = useRef<string | null>(null);

  useEffect(() => setDraftQuery(state.query), [state.query]);

  const request = useMemo(() => requestFor(state), [state]);
  const queryKey = useMemo(() => ["marks.search", request] as const, [request]);
  const sourceState = useMemo(() => {
    if (!state.query || !replacementSourceSearch || replacementSourceSearch === search) return null;
    const source = readSearchState(replacementSourceSearch);
    return source.query ? source : null;
  }, [replacementSourceSearch, search, state.query]);
  const sourceQueryKey = useMemo(() => (
    sourceState ? ["marks.search", requestFor(sourceState)] as const : null
  ), [sourceState]);
  const sourceQueryState = sourceQueryKey ? queryClient.getQueryState(sourceQueryKey) : undefined;
  const sourceError = sourceQueryState?.error instanceof Error ? sourceQueryState.error : null;
  const sourceData = sourceQueryKey && (!sourceError || errorCode(sourceError) === "CONFLICT")
    ? queryClient.getQueryData<InfiniteData<SearchPageResult, SearchPageParam>>(sourceQueryKey)
    : undefined;
  const destinationData = queryClient.getQueryData<InfiniteData<SearchPageResult, SearchPageParam>>(queryKey);
  const restorationKey = `${search}\n${restoreScrollOffset}`;
  const query = useInfiniteQuery<
    SearchPageResult,
    Error,
    InfiniteData<SearchPageResult, SearchPageParam>,
    typeof queryKey,
    SearchPageParam
  >({
    enabled: state.query.length > 0,
    gcTime: Infinity,
    getNextPageParam: (lastPage, pages) => {
      const offset = pages.reduce((sum, page) => sum + page.items.length, 0);
      return offset < lastPage.total
        ? { expectedCorpusVersion: pages[0]!.meta.corpusVersion, offset }
        : undefined;
    },
    initialPageParam: { expectedCorpusVersion: undefined as string | undefined, offset: 0 },
    placeholderData: () => sourceData,
    queryFn: ({ pageParam }) => api.search({
      ...request,
      ...(pageParam.expectedCorpusVersion
        ? { expectedCorpusVersion: pageParam.expectedCorpusVersion }
        : {}),
      offset: pageParam.offset,
    }),
    queryKey,
    staleTime: Infinity,
  });
  const conflict = errorCode(query.error) === "CONFLICT";
  const replacementFailure = Boolean(query.error && sourceData && !destinationData && !conflict);
  const data = query.data ?? (replacementFailure ? sourceData : undefined);
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 188,
    getItemKey: (index) => items[index]?.serialNumber ?? index,
    getScrollElement: () => viewportRef.current,
    initialRect: { height: 640, width: 1200 },
    overscan: 3,
    useFlushSync: false,
  });

  useLayoutEffect(() => {
    if (restoredEntry.current === restorationKey || !data || !viewportRef.current) return;
    restoredEntry.current = restorationKey;
    if (restoreScrollOffset > 0) virtualizer.scrollToOffset(restoreScrollOffset);
    viewportRef.current.scrollTop = restoreScrollOffset;
  }, [data, restorationKey, restoreScrollOffset, virtualizer]);

  useEffect(() => {
    if (
      replacementSourceSearch &&
      query.data?.pages[0]?.offset === 0 &&
      !query.isPlaceholderData
    ) onReplacementLoaded();
  }, [onReplacementLoaded, query.data, query.isPlaceholderData, replacementSourceSearch]);

  useEffect(() => {
    const target = loadMoreRef.current;
    const root = viewportRef.current;
    if (!target || !root || !query.hasNextPage || query.error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    }, { root, rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [query.error, query.fetchNextPage, query.hasNextPage, query.isFetchingNextPage]);

  function updateState(patch: Partial<SearchState>) {
    const sourceSearch = sourceData && !destinationData
      ? replacementSourceSearch
      : destinationData && (!query.error || conflict)
        ? search
        : undefined;
    onNavigate(searchHref({ ...state, ...patch }), sourceSearch);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queryValue = draftQuery.trim();
    if (!queryValue) return;
    if (queryValue === state.query) {
      void queryClient.resetQueries({ exact: true, queryKey });
    } else {
      updateState({ query: queryValue });
    }
  }

  const total = data?.pages[0]?.total ?? 0;

  return (
    <main className="search-shell">
      <header className="search-heading">
        <p className="eyebrow">United States trademarks / Class 025</p>
        <h1>TRADEMARK<br />TURTLE</h1>
      </header>

      <form className="search-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="trademark-search">Search trademarks</label>
        <Input
          id="trademark-search"
          maxLength={200}
          onChange={(event) => setDraftQuery(event.target.value)}
          placeholder="One literal mark query"
          required
          size="lg"
          type="search"
          value={draftQuery}
        />
        <Button size="xl" type="submit">Search</Button>
      </form>

      <section aria-label="Search options" className="search-options">
        <fieldset>
          <legend>Match</legend>
          <label>
            <input
              checked={state.exact}
              disabled={state.exact && !state.partial}
              onChange={(event) => updateState({ exact: event.target.checked })}
              type="checkbox"
            />
            Exact
          </label>
          <label>
            <input
              checked={state.partial}
              disabled={state.partial && !state.exact}
              onChange={(event) => updateState({ partial: event.target.checked })}
              type="checkbox"
            />
            Partial
          </label>
        </fieldset>
        <label>
          Status
          <select onChange={(event) => updateState({ status: event.target.value as SearchState["status"] })} value={state.status}>
            <option value="all">All</option>
            <option value="live">Live</option>
            <option value="dead">Dead</option>
          </select>
        </label>
        <label>
          Type
          <select onChange={(event) => updateState({ type: event.target.value as SearchState["type"] })} value={state.type}>
            <option value="all">All</option>
            <option value="design">Design</option>
            <option value="typeset">Typeset</option>
            <option value="text">Text</option>
          </select>
        </label>
        <label>
          Registered
          <select
            onChange={(event) => updateState({ registered: event.target.value as SearchState["registered"] })}
            value={state.registered}
          >
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Sort
          <select onChange={(event) => updateState({ sort: event.target.value as SearchState["sort"] })} value={state.sort}>
            <option value="relevance">Relevance</option>
            <option value="newest-activity">Newest activity</option>
            <option value="oldest-activity">Oldest activity</option>
          </select>
        </label>
      </section>

      {!state.query ? <p className="search-prompt">Enter one mark query to search Class 025 records.</p> : null}
      {query.isPending && state.query ? <p className="search-message">Searching Class 025…</p> : null}
      {query.error ? (
        <div className="search-error">
          <p className="error-message" role="alert">
            {conflict
              ? "The trademark corpus changed. Run the search again before continuing."
              : replacementFailure
                ? "New search could not be loaded. Previous results are still shown."
                : "Search could not be loaded."}
          </p>
          {conflict ? (
            <Button
              onClick={() => void queryClient.resetQueries({ exact: true, queryKey })}
              variant="outline"
            >
              Run search again
            </Button>
          ) : null}
        </div>
      ) : null}
      {data && !query.error && total === 0
        ? <p className="search-message">No Class 025 marks match this search.</p>
        : null}

      {data && total > 0 && (!query.error || conflict || replacementFailure) ? (
        <section aria-label="Search results" className="search-results">
          <div className="results-rule">
            <p>{total} {total === 1 ? "result" : "results"}</p>
            <p>Corpus through {data.pages[0]!.meta.corpusThroughDate}</p>
          </div>
          <div
            className="search-results-viewport"
            data-testid="search-results-viewport"
            key={restorationKey}
            ref={viewportRef}
          >
            <div className="search-results-size" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index]!;
                return (
                  <article
                    className="search-result-row"
                    data-index={virtualRow.index}
                    data-testid="search-result-row"
                    key={item.serialNumber}
                    ref={virtualizer.measureElement}
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <a
                      href={`/marks/${item.serialNumber}`}
                      onClick={(event) => {
                        if (
                          event.button !== 0 ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) return;
                        event.preventDefault();
                        onOpenMark(item.serialNumber, viewportRef.current?.scrollTop ?? 0);
                      }}
                    >
                      {item.wordMark}
                    </a>
                    <div className="result-facts">
                      <span>{item.match}</span>
                      <span>{item.status}</span>
                      <span>IC {item.internationalClasses.join(", ")}</span>
                      <span>{item.type}</span>
                    </div>
                    <p>{item.owner ?? "Owner unavailable"}</p>
                    <p className="result-goods">{item.goodsServicesExcerpt ?? "Goods/services unavailable"}</p>
                    <p className="result-identities tabular-nums">
                      Serial {item.serialNumber}
                      {item.registrationNumber ? ` · Registration ${item.registrationNumber}` : " · Not registered"}
                      {item.statusDate ? ` · Status ${item.statusDate}` : ""}
                    </p>
                  </article>
                );
              })}
              <div
                aria-hidden="true"
                className="load-more-sentinel"
                ref={loadMoreRef}
                style={{ transform: `translateY(${Math.max(virtualizer.getTotalSize() - 1, 0)}px)` }}
              />
            </div>
          </div>
          {query.isFetchingNextPage ? <p className="search-message">Loading more results…</p> : null}
        </section>
      ) : null}
      <footer className="legal-disclaimer">
        Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.
      </footer>
    </main>
  );
}
