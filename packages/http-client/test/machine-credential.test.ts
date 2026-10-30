import { expect, test } from "bun:test";
import { createTmterminalClient, isMerchbaseApiKey } from "../src/index.ts";

const key =
  "mbk_v1.eyJjbGllbnRJZCI6ImNsaWVudC5hY2Nlc3MiLCJjbGllbnRTZWNyZXQiOiJhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIn0";
test("published credential envelope becomes native Cloudflare headers without a bearer", async () => {
  let sent = new Headers();
  const client = createTmterminalClient({
    apiKey: key,
    fetch: (_input, init) => {
      sent = new Headers(init?.headers);
      return Promise.resolve(
        Response.json({ result: { data: { accountId: "owner", credential: { type: "api-key" } } } })
      );
    },
  });
  await client.account.get();
  expect(sent.get("CF-Access-Client-Id")).toBe("client.access");
  expect(sent.get("CF-Access-Client-Secret")).toBe("a".repeat(64));
  expect(sent.has("Authorization")).toBe(false);
});
test("rejects old, malformed and noncanonical envelopes without exposing their content", () => {
  for (const value of [
    "ak_old_secret",
    "mbk_v2.secret",
    `${key}=`,
    "mbk_v1.e30",
    key.replace("mbk_v1.", "mbk_v1.!"),
  ]) {
    expect(isMerchbaseApiKey(value)).toBe(false);
    expect(() => createTmterminalClient({ apiKey: value })).toThrow("Invalid Merchbase API key");
  }
});

test("native credentials never follow a redirect to another origin", async () => {
  let forwarded = false;
  const receiver = Bun.serve({
    fetch: () => {
      forwarded = true;
      return Response.json({ result: { data: {} } });
    },
    port: 0,
  });
  const gateway = Bun.serve({ fetch: () => Response.redirect(receiver.url, 302), port: 0 });
  try {
    const client = createTmterminalClient({ apiKey: key, baseUrl: gateway.url.toString() });
    await expect(client.account.get()).rejects.toThrow();
    expect(forwarded).toBe(false);
  } finally {
    gateway.stop(true);
    receiver.stop(true);
  }
});
