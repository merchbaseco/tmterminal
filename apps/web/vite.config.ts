import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  const apiPort = process.env.TMTERMINAL_API_PORT?.trim();
  if (command === "serve" && !apiPort) {
    throw new Error("TMTERMINAL_API_PORT is required; set it with dev-port 1");
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: apiPort
      ? {
          proxy: {
            "/api": `http://127.0.0.1:${apiPort}`,
          },
        }
      : undefined,
  };
});
