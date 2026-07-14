import { verifyToken } from "@clerk/backend";

export type VerifyClerkToken = (token: string) => Promise<string | null>;

type ClerkVerifierOptions = {
  authorizedParties?: string[];
  secretKey?: string;
};

export function createClerkVerifier({
  authorizedParties,
  secretKey,
}: ClerkVerifierOptions): VerifyClerkToken {
  if (!secretKey) {
    return async () => null;
  }

  if (!authorizedParties?.length) {
    throw new Error("CLERK_AUTHORIZED_PARTIES is required when Clerk is enabled");
  }

  return async (token) => {
    try {
      const session = await verifyToken(token, { authorizedParties, secretKey });
      return session.sub;
    } catch {
      return null;
    }
  };
}
