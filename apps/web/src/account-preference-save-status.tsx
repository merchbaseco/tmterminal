import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon, Tick01Icon } from "@hugeicons-pro/core-stroke-rounded";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const feedbackTransition = {
  duration: 0.12,
  ease: [0.23, 1, 0.32, 1],
} as const;

export function AccountPreferenceSaveStatus({
  error,
  saved,
  saving,
}: {
  error: string | null;
  saved: boolean;
  saving: boolean;
}) {
  const reduceMotion = useReducedMotion();

  if (error) {
    return (
      <p className="m-0 shrink-0 text-base text-destructive-foreground" role="alert">
        {error}
      </p>
    );
  }

  const visible = saving || saved;
  let accessibleStatus = "";
  if (saving) {
    accessibleStatus = "Saving search preferences";
  } else if (saved) {
    accessibleStatus = "Search preferences saved";
  }

  return (
    <div className="relative min-h-6 min-w-24 shrink-0 text-base text-muted-foreground">
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.span
            animate={{ opacity: 1 }}
            aria-hidden="true"
            className="absolute inset-y-0 right-0 flex items-center gap-1.5 whitespace-nowrap"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : feedbackTransition}
          >
            <span className="relative size-4 shrink-0">
              <AnimatePresence initial={false}>
                <motion.span
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0"
                  exit={{ opacity: 0, scale: 0.85 }}
                  initial={{ opacity: 0, scale: 0.85 }}
                  key={saving ? "saving" : "saved"}
                  transition={reduceMotion ? { duration: 0 } : feedbackTransition}
                >
                  <HugeiconsIcon
                    className={
                      saving
                        ? "size-4 animate-spin [animation-duration:650ms] motion-reduce:animate-none"
                        : "size-4 text-emerald-500"
                    }
                    icon={saving ? Loading03Icon : Tick01Icon}
                  />
                </motion.span>
              </AnimatePresence>
            </span>
            {saving ? "Saving" : "Saved"}
          </motion.span>
        ) : null}
      </AnimatePresence>
      <span aria-live="polite" className="sr-only" role="status">
        {accessibleStatus}
      </span>
    </div>
  );
}
