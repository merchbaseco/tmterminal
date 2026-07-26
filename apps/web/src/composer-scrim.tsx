import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Joins the sticky search controls to the header as one plate and dissolves
 * results into them from below. The dissolve appears only once the document
 * scrolls, so the first rows stay crisp while the page sits at rest.
 */
export function ComposerScrim() {
  const [scrolled, setScrolled] = useState(() => window.scrollY > 0);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div aria-hidden="true" className="composer-scrim">
      <div />
      <div className={cn(!scrolled && "opacity-0")} />
    </div>
  );
}
