import { ClerkProvider } from "@clerk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!root) {
  throw new Error("Web root is missing");
}

if (!publishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is required");
}

createRoot(root).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>,
);
