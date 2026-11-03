import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  markIdentitySchema,
  matchTextsInputSchema,
  screenTextInputSchema,
} from "../api/marks-input.ts";
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
  "Screen returns each matching live trademark once per text; pass texts to screen up to 100 named texts in one call. Screen also matches singulars unless singular is false. Source-text positions remain a website and HTTP concern.",
  "Search returns one page. For continuation, pass meta.dataVersion as expectedDataVersion; restart at offset zero after CONFLICT.",
  "Treat results as trademark evidence, never as a safety verdict or legal advice.",
].join("\n");

const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

const tools = {
  tmterminal_get: {
    annotations: readOnlyAnnotations,
    description:
      "Get one trademark by an exact eight-digit serial number or seven-digit registration number. Returns full mark, owner, class, goods, status, and provenance evidence; failures return a stable Trademark Terminal error.",
    inputSchema: markIdentitySchema,
    title: "Get trademark",
  },
  tmterminal_screen: {
    annotations: readOnlyAnnotations,
    description:
      "Screen complete listing text against live word marks. Pass text for one document, or texts with up to 100 {id, text} items (ids unique) to screen several in one call. One text returns trademarks: each matching trademark once. Texts returns texts: [{id, trademarks}] in input order, each matching trademark once per text. Every contiguous word span is compared as a whole word mark, ignoring case, compatibility forms, and punctuation: apostrophes are dropped (it's matches ITS) and other punctuation separates words. With singular (default true), plural words also match singular marks on both sides: kitten nuggets matches KITTEN NUGGET, milk and cookies matches MILK AND COOKIE. Returns no source-text positions; failures return a stable Trademark Terminal error.",
    inputSchema: z.union([screenTextInputSchema, matchTextsInputSchema]),
    title: "Screen listing text",
  },
  tmterminal_search: {
    annotations: readOnlyAnnotations,
    description:
      "Search United States word trademarks with Multi, Split, or Wildcard semantics. Multi and Split take singular (default false) to also match plural words as singulars. Returns one server-filtered, counted, and sorted page with exact and partial live-match counts; failures return a stable Trademark Terminal error.",
    inputSchema: searchInputSchema,
    title: "Search trademarks",
  },
};

export function createTmterminalMcpServer(source: TmterminalMcpDataSource) {
  const server = new McpServer(TMTERMINAL_MCP_SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: TMTERMINAL_MCP_INSTRUCTIONS,
  });

  server.registerTool("tmterminal_get", tools.tmterminal_get, (input) =>
    runMcpTool(() => source.trademarks.get(input))
  );
  server.registerTool("tmterminal_search", tools.tmterminal_search, (input) =>
    runMcpTool(() => source.trademarks.search(input))
  );
  server.registerTool("tmterminal_screen", tools.tmterminal_screen, (input) =>
    runMcpTool(() =>
      "texts" in input ? source.trademarks.screenTexts(input) : source.trademarks.screen(input)
    )
  );

  // The SDK validates root unions but only exports root objects in tools/list.
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TMTERMINAL_MCP_TOOL_NAMES.map((name) => ({
      ...tools[name],
      inputSchema: toolInputJsonSchema(tools[name].inputSchema),
      name,
    })),
  }));

  return server;
}

function toolInputJsonSchema(schema: z.ZodType) {
  const converted = z.toJSONSchema(schema, { io: "input", target: "draft-7" });
  const branches = converted.anyOf ?? converted.oneOf;
  if (!branches) {
    return ToolSchema.shape.inputSchema.parse(converted);
  }

  const alternatives = new Map<string, Map<string, z.core.JSONSchema.JSONSchema>>();
  for (const branch of branches) {
    for (const [name, property] of Object.entries(branch.properties ?? {})) {
      const fields = alternatives.get(name) ?? new Map();
      let value = property;
      if (typeof property === "boolean") {
        value = property ? {} : { not: {} };
      }
      fields.set(JSON.stringify(value), value);
      alternatives.set(name, fields);
    }
  }
  const properties = Object.fromEntries(
    [...alternatives].map(([name, fields]) => {
      const values = [...fields.values()];
      return [name, values.length === 1 ? values[0] : { anyOf: values }];
    })
  );
  const required = branches[0]?.required?.filter((name) =>
    branches.every((branch) => branch.required?.includes(name))
  );
  return ToolSchema.shape.inputSchema.parse({
    ...converted,
    properties,
    required,
    type: "object",
  });
}
