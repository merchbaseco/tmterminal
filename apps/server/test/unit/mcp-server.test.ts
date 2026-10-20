import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
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

test("tools/list preserves identity alternatives, search modes, constraints, and defaults", async () => {
  const { client, close } = await connectedClient(source());
  try {
    const { tools } = await client.listTools();
    const get = tools.find((tool) => tool.name === "tmterminal_get")?.inputSchema;
    expect(get).toMatchObject({
      anyOf: [
        { additionalProperties: false, required: ["serialNumber"] },
        { additionalProperties: false, required: ["registrationNumber"] },
      ],
      properties: {
        registrationNumber: { pattern: "^\\d{7}$", type: "string" },
        serialNumber: { pattern: "^\\d{8}$", type: "string" },
      },
      type: "object",
    });
    const search = tools.find((tool) => tool.name === "tmterminal_search")?.inputSchema;
    expect(search).toMatchObject({
      allOf: [
        {
          anyOf: [
            { properties: { offset: { maximum: 0 } } },
            { required: ["expectedDataVersion"] },
          ],
        },
      ],
      description: expect.stringContaining("Unicode word token"),
      oneOf: [
        {
          additionalProperties: false,
          properties: {
            match: { default: "both", enum: ["exact", "partial", "both"] },
            mode: { const: "multi" },
          },
          required: ["query", "mode"],
        },
        {
          additionalProperties: false,
          properties: { match: { not: {} }, mode: { const: "split" } },
          required: ["query", "mode"],
        },
        {
          additionalProperties: false,
          properties: { match: { not: {} }, mode: { const: "wildcard" } },
          required: ["query", "mode"],
        },
      ],
      properties: {
        expectedDataVersion: { pattern: "^\\d+$", type: "string" },
        offset: { default: 0, minimum: 0, type: "integer" },
        query: { maxLength: 200, minLength: 1, type: "string" },
        sort: { default: "relevance", enum: ["relevance", "newest-activity", "oldest-activity"] },
        status: { default: "all", enum: ["all", "live", "dead"] },
      },
      required: ["query", "mode"],
      type: "object",
    });
    expect(tools.find((tool) => tool.name === "tmterminal_screen")?.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        text: {
          description: expect.stringContaining("UTF-16"),
          maxLength: 4096,
          minLength: 1,
          type: "string",
        },
        type: { default: "all", enum: ["all", "design", "typeset", "text", "other"] },
      },
      required: ["text"],
      type: "object",
    });
  } finally {
    await close();
  }
});

test("advertised JSON Schema enforces identity, mode, and continuation constraints", async () => {
  const { client, close } = await connectedClient(source());
  try {
    const { tools } = await client.listTools();
    const validator = new AjvJsonSchemaValidator();
    const get = tools.find((tool) => tool.name === "tmterminal_get");
    const search = tools.find((tool) => tool.name === "tmterminal_search");
    if (!(get && search)) {
      throw new Error("Missing Get/Search discovery");
    }
    const validateGet = validator.getValidator(get.inputSchema);
    const validateSearch = validator.getValidator(search.inputSchema);
    for (const identity of [{ serialNumber: "12345678" }, { registrationNumber: "1234567" }]) {
      expect(validateGet(identity).valid).toBe(true);
    }
    for (const identity of [
      {},
      { serialNumber: "123" },
      { registrationNumber: "1234567", serialNumber: "12345678" },
    ]) {
      expect(validateGet(identity).valid).toBe(false);
    }
    for (const mode of ["multi", "split", "wildcard"]) {
      expect(validateSearch({ mode, query: "shirt" }).valid).toBe(true);
      expect(validateSearch({ mode, offset: 25, query: "shirt" }).valid).toBe(false);
      expect(
        validateSearch({ expectedDataVersion: "7", mode, offset: 25, query: "shirt" }).valid
      ).toBe(true);
    }
    expect(validateSearch({ match: "both", mode: "split", query: "shirt" }).valid).toBe(false);
    expect(validateSearch({ mode: "unknown", query: "shirt" }).valid).toBe(false);
    expect(validateSearch({ limit: 10, mode: "multi", query: "shirt" }).valid).toBe(false);
    expect(validateSearch({ extra: true, mode: "multi", query: "shirt" }).valid).toBe(false);
  } finally {
    await close();
  }
});

test("tools/call accepts both identities and all search modes", async () => {
  const inputs: unknown[] = [];
  const testSource = source();
  testSource.trademarks.get = (input) => {
    inputs.push(input);
    return Promise.resolve({}) as never;
  };
  const { client, close } = await connectedClient(testSource);
  try {
    const identities = [{ serialNumber: "12345678" }, { registrationNumber: "1234567" }];
    const results = await Promise.all([
      ...identities.map((identity) =>
        client.callTool({ arguments: identity, name: "tmterminal_get" })
      ),
      ...["multi", "split", "wildcard"].map((mode) =>
        client.callTool({
          arguments: { mode, query: "Terminal Club" },
          name: "tmterminal_search",
        })
      ),
    ]);
    expect(results.map((result) => result.isError ?? false)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(inputs).toEqual(identities);
  } finally {
    await close();
  }
});

test("tools/call rejects invalid inputs before reading data", async () => {
  const reads: unknown[] = [];
  const testSource = source();
  for (const operation of ["get", "search", "screen"] as const) {
    testSource.trademarks[operation] = (input: unknown) => {
      reads.push(input);
      return Promise.resolve({}) as never;
    };
  }
  const { client, close } = await connectedClient(testSource);
  try {
    const invalid = [
      { arguments: {}, name: "tmterminal_get" },
      { arguments: { serialNumber: "123" }, name: "tmterminal_get" },
      { arguments: { registrationNumber: "12345678" }, name: "tmterminal_get" },
      {
        arguments: { registrationNumber: "1234567", serialNumber: "12345678" },
        name: "tmterminal_get",
      },
      { arguments: { query: "shirt" }, name: "tmterminal_search" },
      { arguments: { mode: "multi", query: " " }, name: "tmterminal_search" },
      { arguments: { limit: 10, mode: "multi", query: "shirt" }, name: "tmterminal_search" },
      { arguments: { mode: "multi", offset: 25, query: "shirt" }, name: "tmterminal_search" },
      { arguments: { mode: "split", query: "!!!" }, name: "tmterminal_search" },
      { arguments: { match: "both", mode: "split", query: "shirt" }, name: "tmterminal_search" },
      { arguments: { mode: "wildcard", query: "a*b*" }, name: "tmterminal_search" },
      { arguments: { text: " " }, name: "tmterminal_screen" },
      { arguments: { text: "x".repeat(4097) }, name: "tmterminal_screen" },
      { arguments: { text: "word ".repeat(129) }, name: "tmterminal_screen" },
      { arguments: { text: "shirt", type: "unknown" }, name: "tmterminal_screen" },
    ];
    for (const result of await Promise.all(invalid.map((request) => client.callTool(request)))) {
      expect(result.isError).toBe(true);
    }
    expect(reads).toEqual([]);
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
