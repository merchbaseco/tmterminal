import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { markIdentitySchema, screenTextInputSchema } from "../api/marks-input.ts";
import { searchInputSchema } from "../api/search-input.ts";
import type { TmterminalMcpDataSource } from "./data-source.ts";
import { runMcpTool } from "./tool-result.ts";

export const TMTERMINAL_MCP_SERVER_INFO = {
  name: "tmterminal",
  title: "Trademark Terminal",
  version: "1.0.0",
} as const;

export const TMTERMINAL_MCP_TOOL_NAMES = [
  "tmterminal_get",
  "tmterminal_search",
  "tmterminal_screen",
] as const;

export const TMTERMINAL_MCP_INSTRUCTIONS = [
  "Use get for an exact serial or registration identity, search to investigate a word or phrase, and screen to check complete listing text.",
  "Screen returns each matching live trademark once; source-text positions remain a website and HTTP concern.",
  "Search returns one page. For continuation, pass meta.dataVersion as expectedDataVersion; restart at offset zero after CONFLICT.",
  "Treat results as trademark evidence, never as a safety verdict or legal advice.",
].join("\n");

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

export function createTmterminalMcpServer(source: TmterminalMcpDataSource) {
  const server = new McpServer(TMTERMINAL_MCP_SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: TMTERMINAL_MCP_INSTRUCTIONS,
  });

  server.registerTool(
    "tmterminal_get",
    {
      annotations: readOnlyAnnotations,
      description:
        "Get one trademark by an exact eight-digit serial number or seven-digit registration number. Returns full mark, owner, class, goods, status, and provenance evidence; failures return a stable Trademark Terminal error.",
      inputSchema: markIdentitySchema,
      title: "Get trademark",
    },
    (input) => runMcpTool(() => source.trademarks.get(input))
  );

  server.registerTool(
    "tmterminal_search",
    {
      annotations: readOnlyAnnotations,
      description:
        "Search United States word trademarks with Multi, Split, or Wildcard semantics. Returns one server-filtered, counted, and sorted page with exact and partial live-match counts; failures return a stable Trademark Terminal error.",
      inputSchema: searchInputSchema,
      title: "Search trademarks",
    },
    (input) => runMcpTool(() => source.trademarks.search(input))
  );

  server.registerTool(
    "tmterminal_screen",
    {
      annotations: readOnlyAnnotations,
      description:
        "Screen complete listing text against live word marks. Returns each matching trademark once without source-text positions; failures return a stable Trademark Terminal error.",
      inputSchema: screenTextInputSchema,
      title: "Screen listing text",
    },
    (input) => runMcpTool(() => source.trademarks.screen(input))
  );

  return server;
}
