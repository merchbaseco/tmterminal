const encodedPattern = /^[A-Za-z0-9_-]+$/;
const paddingPattern = /[=]+$/;
const clientPattern = /^[A-Za-z0-9._-]{1,256}$/;
const secretPattern = /^[A-Za-z0-9_-]{32,512}$/;
const invalid = () => new Error("Invalid Merchbase API key");
export const machineCredentialHeaders = (value: string) => {
  try {
    if (!value.startsWith("mbk_v1.") || value.length > 2048) {
      throw invalid();
    }
    const encoded = value.slice(7);
    if (!encodedPattern.test(encoded)) {
      throw invalid();
    }
    const json = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    if (
      btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(paddingPattern, "") !== encoded
    ) {
      throw invalid();
    }
    const body: unknown = JSON.parse(json);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(",") !== "clientId,clientSecret" ||
      !("clientId" in body) ||
      !("clientSecret" in body) ||
      typeof body.clientId !== "string" ||
      !clientPattern.test(body.clientId) ||
      typeof body.clientSecret !== "string" ||
      !secretPattern.test(body.clientSecret)
    ) {
      throw invalid();
    }
    return { "CF-Access-Client-Id": body.clientId, "CF-Access-Client-Secret": body.clientSecret };
  } catch {
    // biome-ignore lint/style/useErrorCause: Parser errors can contain the credential.
    throw invalid();
  }
};
