import type { ReactNode } from "react";

const searchModes = [
  {
    name: "Multi",
    text: "Search one word mark as entered. Exact results match the whole mark; partial results contain the query anywhere in the mark.",
  },
  {
    name: "Split",
    text: "Break a phrase into adjacent word combinations and search each combination as an exact mark.",
  },
  {
    name: "Wildcard",
    text: "Use * for unknown text within a word mark, such as IN * WE TRUST. Other punctuation remains literal.",
  },
] as const;

export function HelpPage() {
  return (
    <main className="page-shell isolate min-h-[calc(100dvh-var(--topbar-height,4.5rem))] pt-[clamp(2rem,5vw,5rem)] pb-[clamp(3rem,7vw,7rem)]">
      <header className="border-border border-b pb-[clamp(2rem,4vw,4rem)]">
        <p className="m-0 font-[650] text-[0.75rem] uppercase tracking-[0.1em]">Help</p>
        <h1 className="mt-3 mb-0 font-black text-[clamp(4rem,10vw,10rem)] leading-[0.78] tracking-[-0.055em]">
          SEARCH WITH
          <br />
          CONFIDENCE
        </h1>
        <p className="mt-6 mb-0 max-w-[48rem] text-muted-foreground">
          Trademark Turtle searches official United States trademark records for International Class
          025—the clothing category used by print-on-demand sellers.
        </p>
      </header>

      <section className="grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] gap-x-12 border-border border-b py-[clamp(2rem,4vw,3.5rem)] max-[48rem]:grid-cols-1 max-[48rem]:gap-y-5">
        <h2 className="m-0 font-bold text-base">Search modes</h2>
        <dl className="m-0 grid gap-6">
          {searchModes.map((mode) => (
            <div key={mode.name}>
              <dt className="font-bold">{mode.name}</dt>
              <dd className="m-0 mt-1 max-w-[46rem] text-muted-foreground">{mode.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <HelpSection title="Reading results">
        <p>
          <strong>Live</strong> and <strong>Dead</strong> reflect the current USPTO status. Live
          means the USPTO reports an active application or registration; dead means the record is
          abandoned, cancelled, or expired.
        </p>
        <p>
          <strong>Text</strong> marks claim standard characters. <strong>Design</strong> marks
          protect a specific visual design. <strong>Typeset</strong> describes older records filed
          before the USPTO consistently used the standard-character designation.
        </p>
        <p>
          The serial number identifies the USPTO application. A registration number appears only
          after registration. Use status, type, registration, and sorting controls to narrow the
          result set.
        </p>
      </HelpSection>

      <HelpSection title="Reports">
        <p>
          Reports show marks filed last week, registered last week, or currently published for
          opposition. Every report has its own shareable URL and uses the same filters as search.
        </p>
      </HelpSection>

      <HelpSection title="Data and limitations">
        <p>
          Trademark Turtle processes USPTO source files as they are published. The Status page shows
          the latest processed date and recent processing activity; searches remain available while
          newer files are being processed.
        </p>
        <p>
          This service is not affiliated with or endorsed by the USPTO. Trademark data is
          informational, not legal advice. Verify consequential decisions with the USPTO or
          qualified counsel.
        </p>
      </HelpSection>
    </main>
  );
}

function HelpSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] gap-x-12 border-border border-b py-[clamp(2rem,4vw,3.5rem)] max-[48rem]:grid-cols-1 max-[48rem]:gap-y-5">
      <h2 className="m-0 font-bold text-base">{title}</h2>
      <div className="grid max-w-[48rem] gap-4 text-muted-foreground [&_p]:m-0">{children}</div>
    </section>
  );
}
