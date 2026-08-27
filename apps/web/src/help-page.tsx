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
          Search Marks
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

      <HelpSection title="Check Text">
        <p>
          Paste listing copy. Trademark Terminal finds live marks that appear as exact phrases in
          that text. Highlighted passages are navigation, not a verdict. Selecting a passage filters
          the result list to the marks behind it.
        </p>
      </HelpSection>

      <HelpSection title="Bulk Check">
        <p>
          Enter one phrase per line. Each phrase gets live exact and live partial counts. Counts are
          evidence. They do not say a phrase is safe. Open a phrase to see ordinary search results.
        </p>
      </HelpSection>

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

      <HelpSection title="Mark records">
        <p>
          Each mark has a stable page at its eight-digit serial number. Registration numbers are
          seven digits and appear only after the USPTO registers the mark. The page shows owner,
          classes, goods and services, and status history. Open the official USPTO TSDR record from
          the mark page when you need the government file.
        </p>
      </HelpSection>

      <HelpSection title="Status">
        <p>
          Latest Processed is the newest source coverage date that applied safely. Searches stay
          available while newer files are processed. Public status shows catalog totals and recent
          activity, not individual source errors.
        </p>
      </HelpSection>

      <HelpSection title="Account and API keys">
        <p>
          Search defaults live on Account. Create and retire suite-wide API keys in the{" "}
          <a
            className="text-foreground underline underline-offset-4"
            href="https://merchbase.co/account/api-keys/"
          >
            MerchBase Account Center
          </a>
          . Trademark Terminal does not issue product-specific keys.
        </p>
      </HelpSection>

      <HelpSection title="Automation">
        <p>
          <code>tt</code> is the JSON CLI for search, exact lookup, and listing-text screening.
          <code className="ml-1">@tmterminal/http-client</code> is the typed TypeScript client.
          Hosted MCP at <code>/mcp</code> uses Clerk OAuth, not API keys. Package READMEs own
          install, flags, envelopes, and errors.
        </p>
      </HelpSection>

      <HelpSection title="Data and limitations">
        <p>
          Trademark Terminal processes USPTO source files as they are published. The Status page
          shows the latest processed date and recent processing activity; searches remain available
          while newer files are being processed. V1 materializes complete details for International
          Class 025.
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
