export const legalDisclaimer =
  "Trademark data is informational, not legal advice. Verify critical decisions with the USPTO or qualified counsel.";

export function LegalFooter({ text = legalDisclaimer }: { text?: string }) {
  return (
    <footer className="mt-auto">
      <p className="my-0 py-5 text-[0.75rem] text-muted-foreground leading-5">{text}</p>
    </footer>
  );
}
