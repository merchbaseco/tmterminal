import { createClerkClient } from "@clerk/backend";
import type { FastifyInstance } from "fastify";

const signInTokenTtlSeconds = 60;
const loopbackPeerAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface DevClerkSignIn {
  createToken: (userId: string, expiresInSeconds: number) => Promise<string>;
  userId: string;
}

export function configuredDevClerkSignIn(): DevClerkSignIn | null {
  const userId = process.env.TMTERMINAL_DEV_CLERK_SIGN_IN_USER_ID?.trim();
  if (!userId) {
    return null;
  }

  const secretKey = process.env.MERCHBASE_CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error(
      "MERCHBASE_CLERK_SECRET_KEY is required when TMTERMINAL_DEV_CLERK_SIGN_IN_USER_ID is set"
    );
  }

  const clerk = createClerkClient({ secretKey });
  return {
    createToken: async (clerkUserId, expiresInSeconds) =>
      (
        await clerk.signInTokens.createSignInToken({
          expiresInSeconds,
          userId: clerkUserId,
        })
      ).token,
    userId,
  };
}

export function registerDevClerkSignIn(
  server: FastifyInstance,
  devClerkSignIn: DevClerkSignIn | null
) {
  if (!devClerkSignIn) {
    return;
  }

  // The peer is the gate, not the Host header. A cloud development session
  // reaches the website through a port forwarder, so the browser's Host is the
  // forwarder's name — but the request still arrives from the Vite dev server's
  // /api proxy on this machine. Requiring a loopback peer keeps a widened bind
  // address (see TMTERMINAL_DEV_HOST) from widening who can mint a ticket.
  server.post("/api/dev/clerk-sign-in-token", async (request, reply) => {
    const peer = request.raw.socket.remoteAddress;
    if (!(peer && loopbackPeerAddresses.has(peer))) {
      return reply
        .code(403)
        .send({ error: "Dev Clerk sign-in is only available to a caller on this machine" });
    }

    return {
      expiresInSeconds: signInTokenTtlSeconds,
      ticket: await devClerkSignIn.createToken(devClerkSignIn.userId, signInTokenTtlSeconds),
    };
  });
}
