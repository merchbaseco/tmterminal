import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TRPCError } from "@trpc/server";

import type { TmterminalMcpDataSource } from "../../src/mcp/data-source.ts";
import {
  createTmterminalMcpServer,
  TMTERMINAL_MCP_INSTRUCTIONS,
  TMTERMINAL_MCP_TOOL_NAMES,
} from "../../src/mcp/server.ts";

test("exposes the focused read-only operation inventory", async () => {
  const { client, close } = await connectedClient(source());
  try {
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([...TMTERMINAL_MCP_TOOL_NAMES]);
    expect(client.getInstructions()).toBe(TMTERMINAL_MCP_INSTRUCTIONS);
    for (const tool of listed.tools) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      });
      expect(tool.description?.toLowerCase()).toContain("return");
    }
  } finally {
    await close();
  }
});

test("uses canonical search defaults and returns identical portable JSON", async () => {
  const inputs: unknown[] = [];
  const data = {
    items: [],
    limit: 25 as const,
    liveMatchCounts: { exact: 0, partial: 0 },
    meta: { dataVersion: "7" },
    offset: 0,
    total: 0,
  };
  const testSource = source();
  testSource.trademarks.search = (input) => {
    inputs.push(input);
    return Promise.resolve(data);
  };
  const { client, close } = await connectedClient(testSource);
  try {
    const result = await client.callTool({
      arguments: { mode: "multi", query: "Terminal Club" },
      name: "tmterminal_search",
    });

    expect(inputs).toEqual([
      {
        limit: 25,
        match: "both",
        mode: "multi",
        offset: 0,
        query: "Terminal Club",
        registered: "all",
        sort: "relevance",
        status: "all",
        type: "all",
      },
    ]);
    expect(textJson(result)).toEqual(result.structuredContent);
    expect(result.structuredContent).toEqual(data);
  } finally {
    await close();
  }
});

test("screens one text document and returns unique trademarks without positions", async () => {
  const inputs: unknown[] = [];
  const data = { meta: { dataVersion: "7" }, trademarks: [] };
  const testSource = source();
  testSource.trademarks.screen = (input) => {
    inputs.push(input);
    return Promise.resolve(data);
  };
  const { client, close } = await connectedClient(testSource);
  try {
    const result = await client.callTool({
      arguments: { text: "Terminal Club shirt" },
      name: "tmterminal_screen",
    });

    expect(inputs).toEqual([{ text: "Terminal Club shirt", type: "all" }]);
    expect(result.structuredContent).toEqual(data);
  } finally {
    await close();
  }
});

test("returns stable tool errors without structured content", async () => {
  const testSource = source();
  testSource.trademarks.get = () =>
    Promise.reject(new TRPCError({ code: "NOT_FOUND", message: "Trademark not found" }));
  const { client, close } = await connectedClient(testSource);
  try {
    const result = await client.callTool({
      arguments: { serialNumber: "99999999" },
      name: "tmterminal_get",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textJson(result)).toEqual({
      error: { code: "NOT_FOUND", details: {}, message: "Trademark not found" },
    });
  } finally {
    await close();
  }
});

function source(): TmterminalMcpDataSource {
  const page = { items: [], limit: 25 as const, meta: { dataVersion: "1" }, offset: 0, total: 0 };
  return {
    trademarks: {
      get: async () => ({}) as never,
      screen: async () => ({ meta: page.meta, trademarks: [] }),
      search: async () => ({ ...page, liveMatchCounts: { exact: 0, partial: 0 } }),
    },
  };
}

async function connectedClient(testSource: TmterminalMcpDataSource) {
  const server = createTmterminalMcpServer(testSource);
  const client = new Client({ name: "tmterminal-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function textJson(result: unknown) {
  if (!(result && typeof result === "object" && "content" in result)) {
    throw new Error("MCP result did not contain content");
  }
  const { content } = result as CallToolResult;
  const text = content.find(
    (entry): entry is { text: string; type: "text" } => entry.type === "text"
  )?.text;
  if (!text) {
    throw new Error("MCP result did not contain text content");
  }
  return JSON.parse(text) as unknown;
}
