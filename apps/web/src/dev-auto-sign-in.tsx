import { useSignIn } from "@clerk/react";
import { useEffect, useRef } from "react";

const enabled = import.meta.env.DEV && import.meta.env.VITE_TMTERMINAL_DEV_CLERK_AUTO_SIGN_IN === "true";

export function DevAutoSignIn() {
  const attempted = useRef(false);
  const { fetchStatus, signIn } = useSignIn();

  useEffect(() => {
    if (!enabled || fetchStatus !== "idle" || attempted.current) {
      return;
    }

    attempted.current = true;
    void signInWithDevTicket(signIn);
  }, [fetchStatus, signIn]);

  return null;
}

async function signInWithDevTicket(signIn: ReturnType<typeof useSignIn>["signIn"]) {
  try {
    const response = await fetch("/api/dev/clerk-sign-in-token", { method: "POST" });
    if (!response.ok) {
      console.error(`[DevAutoSignIn] Ticket request failed (${response.status})`);
      return;
    }

    const payload = (await response.json()) as { ticket?: unknown };
    if (typeof payload.ticket !== "string" || !payload.ticket) {
      console.error("[DevAutoSignIn] Ticket response was invalid");
      return;
    }

    const signInResult = await signIn.ticket({ ticket: payload.ticket });
    if (signInResult.error) {
      console.error("[DevAutoSignIn] Clerk rejected the ticket");
      return;
    }

    const finalizeResult = await signIn.finalize();
    if (finalizeResult.error) {
      console.error("[DevAutoSignIn] Clerk did not activate the session");
    }
  } catch {
    console.error("[DevAutoSignIn] Sign-in failed");
  }
}
