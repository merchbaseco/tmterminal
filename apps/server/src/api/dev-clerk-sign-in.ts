import { createClerkClient } from "@clerk/backend";
import type { FastifyInstance } from "fastify";

const signInTokenTtlSeconds = 60;
const localHostname = "127.0.0.1";
const localPeerAddress = "127.0.0.1";

export type DevClerkSignIn = {
  createToken(userId: string, expiresInSeconds: number): Promise<string>;
  userId: string;
};

export function configuredDevClerkSignIn(): DevClerkSignIn | null {
  const userId = process.env.DEV_CLERK_SIGN_IN_USER_ID?.trim();
  if (!userId) {
    return null;
  }

  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required when DEV_CLERK_SIGN_IN_USER_ID is set");
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
  devClerkSignIn: DevClerkSignIn | null,
) {
  if (!devClerkSignIn) {
    return;
  }

  server.post("/api/dev/clerk-sign-in-token", async (request, reply) => {
    if (
      request.hostname.toLowerCase() !== localHostname ||
      request.raw.socket.remoteAddress !== localPeerAddress
    ) {
      return reply.code(403).send({ error: "Dev Clerk sign-in is only available on localhost" });
    }

    return {
      expiresInSeconds: signInTokenTtlSeconds,
      ticket: await devClerkSignIn.createToken(
        devClerkSignIn.userId,
        signInTokenTtlSeconds,
      ),
    };
  });
}
