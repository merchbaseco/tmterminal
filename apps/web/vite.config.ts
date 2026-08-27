import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `TMTERMINAL_DEV_HOST` is the repository's contract for the development
 * server's bind address, and it defaults to loopback. A venue that reaches the
 * website through a port forwarder — a cloud agent session, a container, a
 * remote VM — sets `TMTERMINAL_DEV_HOST=0.0.0.0` for its own dev command,
 * because such forwarders find a session's ports by watching for listening
 * sockets and a 127.0.0.1-only bind is invisible to them. Everywhere else the
 * default keeps the server, and the synthetic seed data behind it, off the
 * network.
 */
const devServerHost = process.env.TMTERMINAL_DEV_HOST?.trim() || "127.0.0.1";

/**
 * A widened bind address is the venue saying it is reached through a forwarder,
 * and a forwarder arrives carrying its own name in `Host`. Vite refuses hosts it
 * does not recognise, which would answer that forwarded request with "Blocked
 * request" instead of the website, so the same knob relaxes the check. A
 * loopback dev server keeps Vite's default host allowlist.
 */
const loopbackDevHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const forwardedDevServer = !loopbackDevHosts.has(devServerHost);

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
          ...(forwardedDevServer ? { allowedHosts: true as const } : {}),
          host: devServerHost,
          proxy: {
            "/api": `http://127.0.0.1:${apiPort}`,
            "/docs": "http://127.0.0.1:5174",
          },
        }
      : undefined,
  };
});
