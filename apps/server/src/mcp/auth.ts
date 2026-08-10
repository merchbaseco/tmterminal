import { ServiceAccessError } from "@merchbaseco/access";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { TmterminalAccess } from "../auth/service-access.ts";

export const TMTERMINAL_MCP_SCOPES = ["openid", "email", "profile"] as const;

const bearerTokenPattern = /^Bearer\s+(\S+)$/i;

export interface McpAuthorizedPrincipal {
  accountId: string;
  merchbaseUserId: string;
}

export interface McpAuthDependencies {
  authorize: (token: string) => Promise<McpAuthorizedPrincipal>;
}

export type McpAuthResult =
  | (McpAuthorizedPrincipal & { authInfo: AuthInfo; status: "authenticated" })
  | { missingScopes: string[]; status: "forbidden" }
  | { status: "unauthorized" }
  | { status: "unavailable" };

export function createTmterminalMcpAuth(access: TmterminalAccess["oauth"]): McpAuthDependencies {
  return {
    authorize: async (token) => {
      const authorized = await access.authorize(token);
      return {
        accountId: authorized.principal.accountId,
        merchbaseUserId: authorized.merchbaseUserId,
      };
    },
  };
}

export async function authenticateMcpRequest(
  authorization: string | string[] | undefined,
  dependencies: McpAuthDependencies
): Promise<McpAuthResult> {
  const token = bearerToken(authorization);
  if (!token || token.startsWith("ak_")) {
    return { status: "unauthorized" };
  }

  try {
    const authorized = await dependencies.authorize(token);
    return {
      ...authorized,
      authInfo: {
        clientId: "clerk",
        extra: { merchbaseUserId: authorized.merchbaseUserId },
        scopes: [...TMTERMINAL_MCP_SCOPES],
        token,
      },
      status: "authenticated",
    };
  } catch (error) {
    if (!(error instanceof ServiceAccessError)) {
      return { status: "unavailable" };
    }
    if (error.code === "insufficient_scope") {
      return { missingScopes: [...TMTERMINAL_MCP_SCOPES], status: "forbidden" };
    }
    if (error.code === "access_denied") {
      return { missingScopes: [], status: "forbidden" };
    }
    if (error.code === "access_unavailable" || error.code === "unknown_service") {
      return { status: "unavailable" };
    }
    return { status: "unauthorized" };
  }
}

function bearerToken(authorization: string | string[] | undefined) {
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  return value?.match(bearerTokenPattern)?.[1] ?? null;
}
