import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { SessionProvider } from "./session.tsx";
import "./globals.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Web root is missing");
}

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>
);
