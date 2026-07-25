import { type InfiniteData, useInfiniteQuery, useMutation } from "@tanstack/react-query";
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
import { type HighlightTone, highlightTones } from "./highlight-tones.ts";
import { LegalFooter } from "./legal-footer.tsx";
import { SearchComposer, SearchMasthead } from "./search-composer.tsx";
import { TextHighlight } from "./text-highlight.tsx";
import {
  TrademarkEmptyState,
  TrademarkResultRow,
  TrademarkResultSummary,
} from "./trademark-results.tsx";
import { trpcErrorCode } from "./trpc-error-code.ts";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type ScreenInput = RouterInputs["marks"]["screen"];
type ScreenResult = RouterOutputs["marks"]["screen"];
type ScreenResultItem = ScreenResult["queries"][number];
type SearchInput = RouterInputs["marks"]["search"];
type SearchResult = RouterOutputs["marks"]["search"];
interface SearchPageParam {
  expectedDataVersion?: string;
  offset: number;
}

const countFormatter = new Intl.NumberFormat("en-US");
const lineBreakPattern = /\r?\n/u;
const matchLabels = { exact: "", partial: "Partial" } as const;

export interface BulkCheckApi {
  screen: (input: ScreenInput) => Promise<ScreenResult>;
  search: (input: SearchInput) => Promise<SearchResult>;
}

export interface BulkCheckRestoreState {
  kind: "bulk";
  selectedQueryId: string | null;
  value: string;
}

function queriesFrom(value: string) {
  return value
    .split(lineBreakPattern)
    .map((query) => query.trim())
    .filter(Boolean)
    .map((query, index) => ({ id: `line-${index + 1}`, query }));
}

function bulkInvalidActionLabel(queryCount: number) {
  if (queryCount > 100) {
    return "Trim to 100";
  }
  if (queryCount === 0) {
    return "Add a phrase";
  }
}

export function BulkCheckPage({
  api,
  initialState,
  onNavigate,
  onOpenMark,
  restoreScrollOffset = 0,
}: {
  api: BulkCheckApi;
  initialState?: BulkCheckRestoreState;
  onNavigate: (href: string) => void;
  onOpenMark: (
    serialNumber: string,
    scrollOffset: number,
    restoreState: BulkCheckRestoreState
  ) => void;
  restoreScrollOffset?: number;
}) {
  const [value, setValue] = useState(initialState ? initialState.value : "");
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(
    initialState?.selectedQueryId ?? null
  );
  const restored = useRef(false);
  const scrollRestored = useRef(false);
  const queries = useMemo(() => queriesFrom(value), [value]);
  const hasTooManyQueries = queries.length > 100;
  const mutation = useMutation({
    mutationFn: (input: ScreenInput) => api.screen(input),
    onSuccess: (result) => {
      setSelectedQueryId((current) =>
        current && result.queries.some((item) => item.id === current)
          ? current
          : (result.queries.find((item) => matchCount(item) > 0)?.id ??
            result.queries[0]?.id ??
            null)
      );
    },
  });
  const selectedQuery =
    mutation.data?.queries.find((item) => item.id === selectedQueryId) ?? mutation.data?.queries[0];
  const selectedQueryIndex = mutation.data?.queries.findIndex(
    (item) => item.id === selectedQuery?.id
  );
  const selectedTone = highlightTones[(selectedQueryIndex ?? 0) % highlightTones.length] ?? "lime";

  useEffect(() => {
    if (!(initialState && !restored.current)) {
      return;
    }
    restored.current = true;
    mutation.mutate({ queries: queriesFrom(initialState.value), type: "all" });
  }, [initialState, mutation]);

  useLayoutEffect(() => {
    if (!(initialState && mutation.data && !scrollRestored.current)) {
      return;
    }
    scrollRestored.current = true;
    window.scrollTo(0, restoreScrollOffset);
  }, [initialState, mutation.data, restoreScrollOffset]);

  const selectQuery = useCallback((id: string) => setSelectedQueryId(id), []);
  const startOver = useCallback(() => {
    mutation.reset();
    setSelectedQueryId(null);
    setValue("");
    window.scrollTo(0, 0);
  }, [mutation]);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (queries.length === 0 || hasTooManyQueries) {
        return;
      }
      mutation.mutate({ queries, type: "all" });
    },
    [hasTooManyQueries, mutation, queries]
  );
  const openMark = useCallback(
    (serialNumber: string, scrollOffset: number) =>
      onOpenMark(serialNumber, scrollOffset, {
        kind: "bulk",
        selectedQueryId: selectedQuery?.id ?? null,
        value: mutation.data?.queries.map(({ query }) => query).join("\n") ?? value,
      }),
    [mutation.data?.queries, onOpenMark, selectedQuery?.id, value]
  );
  const refreshScreen = useCallback(() => {
    const screenedQueries =
      mutation.data?.queries.map(({ id, query }) => ({ id, query })) ?? queries;
    mutation.mutate({ queries: screenedQueries, type: "all" });
  }, [mutation, mutation.data?.queries, queries]);

  return (
    <main className="page-shell page-start isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col [--search-side-column:clamp(13rem,18vw,16rem)]">
      {mutation.data ? <h1 className="sr-only">Bulk trademark check</h1> : <SearchMasthead />}
      <div className={mutation.data ? undefined : "pt-[clamp(1.5rem,4vw,3.5rem)] pb-5"}>
        <SearchComposer
          actionLabel="Bulk check"
          actionPlacement="below"
          activeTool="bulk"
          fieldLabel="Phrases to check"
          invalidActionLabel={bulkInvalidActionLabel(queries.length)}
          loading={mutation.isPending}
          multiline
          name="queries"
          onNavigate={onNavigate}
          onStartOver={mutation.data ? startOver : undefined}
          onSubmit={submit}
          onValueChange={setValue}
          placeholder={"One phrase per line\nTurtle Club\nOcean Supply"}
          startOverLabel={mutation.data ? "Check different phrases" : undefined}
          value={value}
        />
        {hasTooManyQueries ? (
          <p className="m-0 border-border border-x border-b px-4 py-3 text-destructive-foreground">
            Bulk check accepts up to 100 phrases.
          </p>
        ) : null}
      </div>

      {mutation.error ? (
        <p
          className="m-0 border-border border-x border-b px-4 py-6 text-destructive-foreground"
          role="alert"
        >
          Phrases could not be checked. Try again.
        </p>
      ) : null}

      {mutation.data ? (
        <>
          <PhraseNavigator
            onSelect={selectQuery}
            queries={mutation.data.queries}
            selectedId={selectedQuery?.id ?? null}
          />
          {selectedQuery ? (
            <BulkTrademarkResults
              api={api}
              dataVersion={mutation.data.meta.dataVersion}
              item={selectedQuery}
              onConflict={refreshScreen}
              onOpenMark={openMark}
              tone={selectedTone}
            />
          ) : null}
        </>
      ) : null}
      <LegalFooter />
    </main>
  );
}

function PhraseNavigator({
  onSelect,
  queries,
  selectedId,
}: {
  onSelect: (id: string) => void;
  queries: ScreenResultItem[];
  selectedId: string | null;
}) {
  return (
    <section
      aria-label="Checked phrases"
      className="grid grid-cols-[minmax(0,1fr)_var(--search-side-column)] border-border border-x border-b max-[48rem]:grid-cols-1"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-5">
        {queries.map((item, index) => (
          <PhraseSelection
            active={item.id === selectedId}
            item={item}
            key={item.id}
            onSelect={onSelect}
            tone={highlightTones[index % highlightTones.length] ?? "lime"}
          />
        ))}
      </div>
      <div className="flex min-w-[10rem] items-center justify-center border-border border-l px-4 py-3 max-[48rem]:min-w-0 max-[48rem]:justify-start max-[48rem]:border-t max-[48rem]:border-l-0">
        <p className="m-0 whitespace-nowrap text-base text-muted-foreground tabular-nums sm:text-sm">
          {queries.length} {queries.length === 1 ? "phrase" : "phrases"}
        </p>
      </div>
    </section>
  );
}

function PhraseSelection({
  active,
  item,
  onSelect,
  tone,
}: {
  active: boolean;
  item: ScreenResultItem;
  onSelect: (id: string) => void;
  tone: HighlightTone;
}) {
  const select = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  const total = matchCount(item);
  if (total > 0) {
    return (
      <TextHighlight
        active={active}
        label={`${item.query}, ${total} live ${total === 1 ? "match" : "matches"}`}
        onClick={select}
        tone={tone}
        tooltip={`${total} live ${total === 1 ? "match" : "matches"}`}
      >
        {item.query}
      </TextHighlight>
    );
  }
  return (
    <button
      aria-label={`${item.query}, no live matches`}
      aria-pressed={active}
      className={cn(
        "cursor-pointer border-0 bg-transparent p-0 font-[650] text-muted-foreground underline decoration-2 decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
        active && "text-foreground decoration-foreground"
      )}
      onClick={select}
      type="button"
    >
      {item.query}
    </button>
  );
}

function BulkTrademarkResults({
  api,
  dataVersion,
  item,
  onConflict,
  onOpenMark,
  tone,
}: {
  api: BulkCheckApi;
  dataVersion: string;
  item: ScreenResultItem;
  onConflict: () => void;
  onOpenMark: (serialNumber: string, scrollOffset: number) => void;
  tone: HighlightTone;
}) {
  const request = useMemo(
    () =>
      ({
        limit: 25,
        match: "both",
        mode: "multi",
        query: item.query,
        registered: "all",
        sort: "relevance",
        status: "live",
        type: "all",
      }) as const,
    [item.query]
  );
  const queryKey = useMemo(
    () => ["marks.bulk-search", dataVersion, request] as const,
    [dataVersion, request]
  );
  const query = useInfiniteQuery<
    SearchResult,
    Error,
    InfiniteData<SearchResult, SearchPageParam>,
    typeof queryKey,
    SearchPageParam
  >({
    getNextPageParam: (lastPage, pages) => {
      const offset = pages.reduce((sum, page) => sum + page.items.length, 0);
      return offset < lastPage.total
        ? { expectedDataVersion: pages[0]?.meta.dataVersion, offset }
        : undefined;
    },
    initialPageParam: { expectedDataVersion: dataVersion, offset: 0 },
    queryFn: ({ pageParam }) =>
      api.search({
        ...request,
        ...(pageParam.expectedDataVersion
          ? { expectedDataVersion: pageParam.expectedDataVersion }
          : {}),
        offset: pageParam.offset,
      }),
    queryKey,
    retry: (failureCount, error) => trpcErrorCode(error) !== "CONFLICT" && failureCount < 2,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data } = query;
  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const firstPage = data?.pages[0];
  const total = firstPage?.total ?? 0;
  const conflict = trpcErrorCode(query.error) === "CONFLICT";
  const loadMore = useCallback(() => {
    query.fetchNextPage();
  }, [query.fetchNextPage]);

  return (
    <section aria-label={`Trademark results for ${item.query}`} className="border-border border-x">
      {query.isPending ? (
        <p className="m-0 border-border border-b px-4 py-12 text-base">
          Loading trademark results…
        </p>
      ) : null}
      {query.error ? (
        <div className="flex items-center justify-between gap-4 border-border border-b px-4 py-5">
          <p className="m-0 text-destructive-foreground" role="alert">
            {conflict
              ? "Trademark data changed while these results were open."
              : "Results could not be loaded. Try checking the phrases again."}
          </p>
          {conflict ? (
            <Button className="pill-button shrink-0" onClick={onConflict} variant="outline">
              Refresh matches
            </Button>
          ) : null}
        </div>
      ) : null}
      {firstPage && (!query.error || conflict) ? (
        <>
          <TrademarkResultSummary
            signals={[
              {
                label: "Live exact",
                value: countFormatter.format(firstPage.liveMatchCounts.exact),
              },
              {
                label: "Live partial",
                value: countFormatter.format(firstPage.liveMatchCounts.partial),
              },
            ]}
            totalLabel={`${countFormatter.format(total)} ${total === 1 ? "result" : "results"}`}
          />
          {items.length > 0 ? (
            <ol aria-label="Trademark results" className="m-0 w-full list-none p-0">
              {items.map((result) => (
                <TrademarkResultRow
                  contextLabel={matchLabels[result.match]}
                  indicators={[{ label: item.query, tone }]}
                  item={result}
                  key={result.serialNumber}
                  onOpen={onOpenMark}
                  total={total}
                />
              ))}
            </ol>
          ) : (
            <TrademarkEmptyState
              description={`No exact or partial live word marks matched “${item.query}”.`}
              title="No live matches"
            />
          )}
          {query.hasNextPage ? (
            <div className="flex justify-center border-border border-b px-4 py-5">
              <Button
                className="pill-button"
                loading={query.isFetchingNextPage}
                onClick={loadMore}
                variant="outline"
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function matchCount(item: ScreenResultItem) {
  return item.liveMatches.exact + item.liveMatches.partial;
}
