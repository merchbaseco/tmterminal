import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/docs/",
  cleanUrls: true,
  description: "Search United States trademarks for print-on-demand work.",
  head: [
    ["link", { href: "/docs/favicon.svg", rel: "icon", type: "image/svg+xml" }],
  ],
  ignoreDeadLinks: (url) => url.startsWith("/") && !url.startsWith("/docs"),
  themeConfig: {
    nav: [
      { link: "https://tmterminal.merchbase.co/search", text: "Search" },
      { link: "https://tmterminal.merchbase.co/status", text: "Status" },
    ],
    outline: { level: [2, 3] },
    search: { provider: "local" },
    sidebar: [
      {
        items: [
          { link: "/", text: "Welcome" },
          { link: "/quickstart", text: "Quickstart" },
          { link: "/sign-in", text: "Sign in" },
          { link: "/status", text: "Status" },
        ],
        text: "Get started",
      },
      {
        items: [
          { link: "/search-marks", text: "Search Marks" },
          { link: "/check-text", text: "Check Text" },
          { link: "/bulk-check", text: "Bulk Check" },
          { link: "/results", text: "Results" },
          { link: "/mark-records", text: "Mark records" },
        ],
        text: "Search",
      },
      {
        items: [
          { link: "/cli", text: "CLI" },
          { link: "/http-client", text: "HTTP client" },
          { link: "/mcp", text: "MCP" },
        ],
        text: "Clients",
      },
      {
        items: [
          { link: "/class-025", text: "Class 025" },
          { link: "/legal", text: "Legal" },
        ],
        text: "Limits",
      },
    ],
    siteTitle: false,
  },
  title: "Trademark Terminal",
  vite: {
    esbuild: {
      target: "es2022",
    },
  },
});
