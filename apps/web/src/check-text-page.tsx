import { useMutation } from "@tanstack/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppRouter } from "../../server/src/api/router.ts";
import { type HighlightTone, highlightTones } from "./highlight-tones.ts";
import { LegalFooter } from "./legal-footer.tsx";
import { SearchComposer, SearchMasthead } from "./search-composer.tsx";
import { TextHighlight } from "./text-highlight.tsx";
import {
  TrademarkEmptyState,
  type TrademarkResultItem,
  TrademarkResultRow,
  TrademarkResultSummary,
} from "./trademark-results.tsx";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type MatchInput = RouterInputs["marks"]["match"];
type MatchResult = RouterOutputs["marks"]["match"];
type TextResult = MatchResult["texts"][number];
type TextMatch = TextResult["matches"][number];

interface HighlightGroup {
  end: number;
  key: string;
  matches: TextMatch[];
  start: number;
  tone: HighlightTone;
}

export interface TextCheckApi {
  match: (input: MatchInput) => Promise<MatchResult>;
}

export interface TextCheckRestoreState {
  kind: "text";
  text: string;
}

export function CheckTextPage({
  api,
  initialState,
  onNavigate,
  onOpenMark,
  restoreScrollOffset = 0,
}: {
  api: TextCheckApi;
  initialState?: TextCheckRestoreState;
  onNavigate: (href: string) => void;
  onOpenMark: (
    serialNumber: string,
    scrollOffset: number,
    restoreState: TextCheckRestoreState
  ) => void;
  restoreScrollOffset?: number;
}) {
  const [text, setText] = useState(initialState ? initialState.text : "");
  const [selectedHighlight, setSelectedHighlight] = useState<string | null>(null);
  const restored = useRef(false);
  const scrollRestored = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: MatchInput) => api.match(input),
    onSuccess: () => setSelectedHighlight(null),
  });
  const result = mutation.data?.texts[0];
  const highlights = useMemo(
    () => highlightGroups(result?.matches ?? [], result?.text ?? ""),
    [result?.matches, result?.text]
  );
  const activeHighlight = highlights.find(({ key }) => key === selectedHighlight);
  const visibleHighlights = activeHighlight ? [activeHighlight] : highlights;
  const visibleMatches = activeHighlight?.matches ?? result?.matches ?? [];
  const items = useMemo(() => uniqueTrademarks(visibleMatches), [visibleMatches]);

  useEffect(() => {
    if (!(initialState && !restored.current)) {
      return;
    }
    restored.current = true;
    mutation.mutate({ texts: [{ id: "text", text: initialState.text }], type: "all" });
  }, [initialState, mutation]);

  useLayoutEffect(() => {
    if (!(initialState && mutation.data && !scrollRestored.current)) {
      return;
    }
    scrollRestored.current = true;
    window.scrollTo(0, restoreScrollOffset);
  }, [initialState, mutation.data, restoreScrollOffset]);

  const selectHighlight = useCallback((key: string) => {
    setSelectedHighlight((current) => (current === key ? null : key));
  }, []);
  const startOver = useCallback(() => {
    mutation.reset();
    setSelectedHighlight(null);
    setText("");
    window.scrollTo(0, 0);
  }, [mutation]);
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!text.trim()) {
        return;
      }
      mutation.mutate({ texts: [{ id: "text", text }], type: "all" });
    },
    [mutation, text]
  );
  const openMark = useCallback(
    (serialNumber: string, scrollOffset: number) =>
      onOpenMark(serialNumber, scrollOffset, { kind: "text", text: result?.text ?? text }),
    [onOpenMark, result?.text, text]
  );

  return (
    <main className="page-shell page-start isolate flex min-h-[calc(100dvh-var(--topbar-height,4.5rem))] flex-col [--search-side-column:clamp(13rem,18vw,16rem)]">
      {result ? <h1 className="sr-only">Trademark matches in checked text</h1> : <SearchMasthead />}
      <div className={result ? undefined : "pt-[clamp(1.5rem,4vw,3.5rem)] pb-5"}>
        <SearchComposer
          actionLabel="Check text"
          activeTool="text"
          fieldLabel="Text to check"
          invalidActionLabel={text.trim() ? undefined : "Paste some text"}
          loading={mutation.isPending}
          maxLength={4096}
          name="text"
          onNavigate={onNavigate}
          onStartOver={result ? startOver : undefined}
          onSubmit={submit}
          onValueChange={setText}
          placeholder="Paste a title, description, or block of copy"
          startOverLabel={result ? "Check different text" : undefined}
          value={text}
        />
      </div>

      {mutation.error ? (
        <p
          className="m-0 border-border border-x border-b px-4 py-6 text-destructive-foreground"
          role="alert"
        >
          Text could not be checked. Try again.
        </p>
      ) : null}

      {result ? (
        <>
          <CheckedText
            activeKey={selectedHighlight}
            highlights={highlights}
            onSelect={selectHighlight}
            result={result}
          />
          <section
            aria-label="Text check results"
            aria-live="polite"
            className="border-border border-x"
          >
            <TrademarkResultSummary
              signals={[
                { label: "Live exact", value: items.length },
                { label: "Live partial", value: 0 },
              ]}
              totalLabel={`${items.length} ${items.length === 1 ? "trademark" : "trademarks"}`}
            />
            {items.length > 0 ? (
              <ol aria-label="Trademark results" className="m-0 w-full list-none p-0">
                {items.map((item) => (
                  <TrademarkResultRow
                    indicators={resultIndicators(item.serialNumber, visibleHighlights, result.text)}
                    item={item}
                    key={item.serialNumber}
                    onOpen={openMark}
                    total={items.length}
                  />
                ))}
              </ol>
            ) : (
              <TrademarkEmptyState
                description="No live word marks matched this text."
                title="No live matches"
              />
            )}
          </section>
        </>
      ) : null}
      <LegalFooter />
    </main>
  );
}

function CheckedText({
  activeKey,
  highlights,
  onSelect,
  result,
}: {
  activeKey: string | null;
  highlights: HighlightGroup[];
  onSelect: (key: string) => void;
  result: TextResult;
}) {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const highlight of highlights) {
    if (highlight.start > cursor) {
      content.push(
        <span key={`text-${cursor}`}>{result.text.slice(cursor, highlight.start)}</span>
      );
    }
    content.push(
      <HighlightSelection
        active={highlight.key === activeKey}
        highlight={highlight}
        key={highlight.key}
        onSelect={onSelect}
        text={result.text.slice(highlight.start, highlight.end)}
      />
    );
    cursor = highlight.end;
  }
  if (cursor < result.text.length) {
    content.push(<span key={`text-${cursor}`}>{result.text.slice(cursor)}</span>);
  }

  return (
    <section
      aria-label="Checked text with trademark matches"
      className="border-border border-x border-b"
    >
      <p className="m-0 whitespace-pre-wrap text-pretty px-4 py-5 text-xl">{content}</p>
    </section>
  );
}

function HighlightSelection({
  active,
  highlight,
  onSelect,
  text,
}: {
  active: boolean;
  highlight: HighlightGroup;
  onSelect: (key: string) => void;
  text: string;
}) {
  const select = useCallback(() => onSelect(highlight.key), [highlight.key, onSelect]);
  const trademarkCount = uniqueTrademarks(highlight.matches).length;
  return (
    <TextHighlight
      active={active}
      label={`${text}, ${trademarkCount} matching ${trademarkCount === 1 ? "trademark" : "trademarks"}`}
      onClick={select}
      tone={highlight.tone}
      tooltip={`${trademarkCount} matching ${trademarkCount === 1 ? "trademark" : "trademarks"}`}
    >
      {text}
    </TextHighlight>
  );
}

function highlightGroups(matches: TextMatch[], text: string) {
  const groups: Omit<HighlightGroup, "tone">[] = [];
  for (const match of matches) {
    const current = groups.at(-1);
    if (current && match.start < current.end) {
      current.end = Math.max(current.end, match.end);
      current.key = `${current.start}-${current.end}`;
      current.matches.push(match);
    } else {
      groups.push({
        end: match.end,
        key: `${match.start}-${match.end}`,
        matches: [match],
        start: match.start,
      });
    }
  }
  const toneByPhrase = new Map<string, HighlightTone>();
  return groups.map((group) => {
    const phrase = text.slice(group.start, group.end).normalize("NFKC").toLocaleLowerCase();
    let tone = toneByPhrase.get(phrase);
    if (!tone) {
      tone = highlightTones[toneByPhrase.size % highlightTones.length] ?? "lime";
      toneByPhrase.set(phrase, tone);
    }
    return { ...group, tone };
  });
}

function resultIndicators(serialNumber: string, highlights: HighlightGroup[], text: string) {
  const indicators = new Map<string, { label: string; tone: HighlightTone }>();
  for (const highlight of highlights) {
    if (
      highlight.matches.some((match) =>
        match.trademarks.some((trademark) => trademark.serialNumber === serialNumber)
      )
    ) {
      const label = text.slice(highlight.start, highlight.end);
      indicators.set(`${label.normalize("NFKC").toLocaleLowerCase()}-${highlight.tone}`, {
        label,
        tone: highlight.tone,
      });
    }
  }
  return [...indicators.values()];
}

function uniqueTrademarks(matches: TextMatch[]) {
  const bySerialNumber = new Map<string, TrademarkResultItem>();
  for (const match of matches) {
    for (const trademark of match.trademarks) {
      bySerialNumber.set(trademark.serialNumber, trademark);
    }
  }
  return [...bySerialNumber.values()];
}
