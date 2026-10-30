import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const sessionActions = {
  manageAccount: () => window.location.assign("https://merchbase.co/account/profile/"),
  signIn: () => window.location.reload(),
  signOut: () => window.location.assign("/cdn-cgi/access/logout"),
};
const SessionContext = createContext({ signedIn: false, ...sessionActions });
export const useSession = () => useContext(SessionContext);
export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<
    "loading" | "signed-in" | "signed-out" | "denied" | "unavailable"
  >("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    })
      .then(async (response) => {
        if (response.status === 401) {
          return "signed-out" as const;
        }
        if (response.status === 403) {
          return "denied" as const;
        }
        if (!response.ok) {
          return "unavailable" as const;
        }
        const body: unknown = await response.json();
        return body &&
          typeof body === "object" &&
          "authenticated" in body &&
          body.authenticated === true
          ? ("signed-in" as const)
          : ("unavailable" as const);
      })
      .then((next) => {
        if (!controller.signal.aborted) {
          setState(next);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState("unavailable");
        }
      });
    return () => controller.abort();
  }, []);
  if (state === "loading") {
    return (
      <p aria-live="polite" className="page-shell page-start">
        Loading your session…
      </p>
    );
  }
  if (state === "unavailable" || state === "denied") {
    return (
      <main className="page-shell page-start" role="alert">
        <p>
          {state === "denied"
            ? "Merchbase access is required to use Trademark Terminal."
            : "Trademark Terminal access is temporarily unavailable."}
        </p>
        <button onClick={sessionActions.signIn} type="button">
          Try again
        </button>
        <a href="https://merchbase.co/account/">Your account</a>
      </main>
    );
  }
  return (
    <SessionContext value={{ signedIn: state === "signed-in", ...sessionActions }}>
      {children}
    </SessionContext>
  );
};
