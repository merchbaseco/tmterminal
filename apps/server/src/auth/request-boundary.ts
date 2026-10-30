import type { IncomingHttpHeaders } from "node:http";
import { ServiceAccessError } from "@merchbaseco/access";

const loopbackHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const mcpHosts = ["tmterminal.merchbase.co", "tmterminal-api.merchbase.co"];
const mcpPaths = new Set([
  "/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);

export const isMcpPath = (path: string | undefined) =>
  typeof path === "string" && mcpPaths.has(path);

export const requestSurface = (
  headers: IncomingHttpHeaders,
  development: boolean,
  path?: string
) => {
  const { host } = headers;
  if (host && isMcpPath(path) && mcpHosts.includes(host)) {
    return "api";
  }
  if (development && host && loopbackHost.test(host)) {
    return "interactive";
  }
  if (host === "tmterminal.merchbase.co") {
    return "interactive";
  }
  if (host === "tmterminal-api.merchbase.co") {
    return "api";
  }
  if (host === "tmterminal-internal.merchbase.co") {
    return "internal";
  }
  throw new ServiceAccessError("unauthenticated");
};
export const originAssertion = (headers: IncomingHttpHeaders) => {
  const value = headers["cf-access-jwt-assertion"];
  return typeof value === "string" ? value : "";
};
