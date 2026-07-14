export type SelectedCredential =
  | { type: "api-key"; token: string }
  | { type: "clerk"; token: string };

type CredentialHeaders = {
  authorization?: string;
  cookie?: string;
};

export class CredentialSelectionError extends Error {
  readonly code = "BAD_REQUEST";

  constructor() {
    super("BAD_REQUEST");
  }
}

function bearerToken(authorization: string | undefined) {
  const match = authorization?.match(/^Bearer (\S+)$/i);
  return match?.[1] ?? null;
}

function sessionCookie(cookie: string | undefined) {
  const value = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("__session="))
    ?.slice("__session=".length);

  return value || null;
}

export function selectCredential(headers: CredentialHeaders): SelectedCredential | null {
  const bearer = bearerToken(headers.authorization);
  const apiKey = bearer?.startsWith("ttk_") ? bearer : null;
  const clerkToken = apiKey ? sessionCookie(headers.cookie) : bearer ?? sessionCookie(headers.cookie);

  if (apiKey && clerkToken) {
    throw new CredentialSelectionError();
  }

  if (apiKey) {
    return { type: "api-key", token: apiKey };
  }

  if (clerkToken) {
    return { type: "clerk", token: clerkToken };
  }

  return null;
}
