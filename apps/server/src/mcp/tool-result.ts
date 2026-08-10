import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TRPCError } from "@trpc/server";

const publicCodes = new Set([
  "BAD_REQUEST",
  "CONFLICT",
  "FORBIDDEN",
  "NOT_FOUND",
  "SERVICE_UNAVAILABLE",
  "UNAUTHORIZED",
]);

export async function runMcpTool(read: () => Promise<object>): Promise<CallToolResult> {
  try {
    const value = await read();
    const structuredContent = { ...value };
    return {
      content: [{ text: JSON.stringify(structuredContent), type: "text" }],
      structuredContent,
    };
  } catch (error) {
    const mappedError = publicError(error);
    if (mappedError.code === "INTERNAL_ERROR") {
      console.error("Trademark Terminal MCP read failed.", summarizeError(error));
    }
    const payload = { error: mappedError };
    return {
      content: [{ text: JSON.stringify(payload), type: "text" }],
      isError: true,
    };
  }
}

function publicError(error: unknown) {
  if (!(error instanceof TRPCError)) {
    return {
      code: "INTERNAL_ERROR",
      details: {},
      message: "Trademark Terminal could not complete this request.",
    };
  }

  if (error.code === "TOO_MANY_REQUESTS") {
    return { code: "RATE_LIMITED", details: {}, message: "Request rate limit exceeded." };
  }
  if (error.code === "TIMEOUT") {
    return {
      code: "SERVICE_UNAVAILABLE",
      details: {},
      message: "Trademark Terminal is temporarily unavailable.",
    };
  }
  if (error.code === "UNPROCESSABLE_CONTENT") {
    return { code: "BAD_REQUEST", details: {}, message: error.message };
  }
  if (publicCodes.has(error.code)) {
    return { code: error.code, details: {}, message: error.message };
  }
  return {
    code: "INTERNAL_ERROR",
    details: {},
    message: "Trademark Terminal could not complete this request.",
  };
}

function summarizeError(error: unknown) {
  return {
    code: error instanceof TRPCError ? error.code : "UNKNOWN",
    name: error instanceof Error ? error.name : "UnknownError",
  };
}
