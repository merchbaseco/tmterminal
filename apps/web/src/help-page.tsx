import type { ReactNode } from "react";
import { PageMasthead } from "./page-masthead.tsx";

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
    <main className="page-shell page-start isolate min-h-[calc(100dvh-var(--topbar-height,4.5rem))] pb-[clamp(3rem,7vw,7rem)]">
      <PageMasthead
        description="Know the result before you make the call."
        title="SEARCH SMARTER"
      />

      <section className="mt-[clamp(2.5rem,5vw,4.5rem)] grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] border-border border-y max-[48rem]:grid-cols-1">
        <h2 className="m-0 border-border border-r py-[clamp(2rem,4vw,3.5rem)] pr-[clamp(1.5rem,3vw,3rem)] font-semibold text-base max-[48rem]:border-r-0 max-[48rem]:pr-0 max-[48rem]:pb-0">
          Search modes
        </h2>
        <dl className="m-0 grid gap-6 py-[clamp(2rem,4vw,3.5rem)] pl-[clamp(1.5rem,3vw,3rem)] max-[48rem]:pt-5 max-[48rem]:pl-0">
          {searchModes.map((mode) => (
            <div key={mode.name}>
              <dt className="font-semibold">{mode.name}</dt>
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

      <HelpSection title="Data and limitations">
        <p>
          Trademark Terminal processes USPTO source files as they are published. The Status page
          shows the latest processed date and recent processing activity; searches remain available
          while newer files are being processed.
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
    <section className="grid grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)] border-border border-b max-[48rem]:grid-cols-1">
      <h2 className="m-0 border-border border-r py-[clamp(2rem,4vw,3.5rem)] pr-[clamp(1.5rem,3vw,3rem)] font-semibold text-base max-[48rem]:border-r-0 max-[48rem]:pr-0 max-[48rem]:pb-0">
        {title}
      </h2>
      <div className="grid max-w-[48rem] gap-4 py-[clamp(2rem,4vw,3.5rem)] pl-[clamp(1.5rem,3vw,3rem)] text-muted-foreground max-[48rem]:pt-5 max-[48rem]:pl-0 [&_p]:m-0">
        {children}
      </div>
    </section>
  );
}
