import { productVersion } from "./product-version.ts";

export const legalDisclaimer =
  "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.";

export function LegalFooter({ text = legalDisclaimer }: { text?: string }) {
  return (
    <footer className="mt-auto py-5">
      <p className="my-0 text-[0.75rem] text-muted-foreground leading-5">{text}</p>
      <p className="my-0 mt-1 text-[0.75rem] text-muted-foreground leading-5">v{productVersion}</p>
    </footer>
  );
}
