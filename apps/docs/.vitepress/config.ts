import { defineConfig } from "vitepress";

export default defineConfig({
  base: "/docs/",
  cleanUrls: true,
  description: "Search United States trademarks for print-on-demand work.",
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
          { link: "/", text: "What this is" },
          { link: "/sign-in", text: "Sign in and API keys" },
          { link: "/status", text: "How current the data is" },
        ],
        text: "Start",
      },
      {
        items: [
          { link: "/search-marks", text: "Search Marks" },
          { link: "/reading-results", text: "Reading results" },
          { link: "/check-text", text: "Check Text" },
          { link: "/bulk-check", text: "Bulk Check" },
          { link: "/mark-records", text: "Mark records" },
        ],
        text: "Search",
      },
      {
        items: [
          { link: "/automate", text: "Which client to use" },
          { link: "/cli", text: "CLI" },
          { link: "/http-client", text: "HTTP client" },
          { link: "/mcp", text: "MCP" },
        ],
        text: "Automate",
      },
      {
        items: [
          { link: "/class-025", text: "Class 025 and what we do not do" },
          { link: "/legal", text: "Legal and USPTO" },
        ],
        text: "Limits",
      },
    ],
    siteTitle: "Trademark Terminal",
  },
  title: "Trademark Terminal",
  vite: {
    esbuild: {
      target: "es2022",
    },
  },
});
