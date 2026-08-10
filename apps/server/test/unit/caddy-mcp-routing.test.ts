import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const caddyfile = readFileSync(new URL("../../../../Caddyfile", import.meta.url), "utf8");
const serverPaths = [
  "/api/*",
  "/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-authorization-server/mcp",
];

test("routes only the API, MCP, and OAuth discovery paths to Fastify", () => {
  const matcher = caddyfile.split("\n").find((line) => line.trim().startsWith("@server path "));

  expect(matcher?.trim()).toBe(`@server path ${serverPaths.join(" ")}`);
  expect(caddyfile).toContain("handle @server {");
  expect(caddyfile).toContain("reverse_proxy api:3000");
});
