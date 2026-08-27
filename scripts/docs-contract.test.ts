import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("Caddy serves /docs and redirects /help", async () => {
  const caddy = await readFile(new URL("Caddyfile", root), "utf8");

  expect(caddy).toContain("redir /help /docs 308");
  expect(caddy).toContain("handle /docs*");
  expect(caddy).toContain("try_files {path} {path}.html {path}/index.html /docs/index.html");
});

test("the web image copies the VitePress build to /srv/docs", async () => {
  const dockerfile = await readFile(new URL("Dockerfile", root), "utf8");

  expect(dockerfile).toContain("COPY apps/docs/package.json apps/docs/package.json");
  expect(dockerfile).toContain("bun run --cwd apps/docs build");
  expect(dockerfile).toContain("/app/apps/docs/.vitepress/dist /srv/docs");
});

test("VitePress is mounted at /docs/", async () => {
  const config = await readFile(new URL("apps/docs/.vitepress/config.ts", root), "utf8");

  expect(config).toContain('base: "/docs/"');
  expect(config).toContain('link: "/search-marks"');
  expect(config).toContain('link: "/cli"');
  expect(config).toContain('link: "/mcp"');
});

test("the website sends Docs to /docs and does not keep a Help page", async () => {
  const app = await readFile(new URL("apps/web/src/app.tsx", root), "utf8");

  expect(app).toContain('href="/docs"');
  expect(app).toContain('window.location.replace("/docs/")');
  expect(app).not.toContain("HelpPage");
});
