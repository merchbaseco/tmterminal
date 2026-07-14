import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Web root is missing");
}

createRoot(root).render(
  <StrictMode>
    <main>
      <p>Authenticated trademark search</p>
      <h1>TRADEMARK TURTLE</h1>
    </main>
  </StrictMode>,
);
