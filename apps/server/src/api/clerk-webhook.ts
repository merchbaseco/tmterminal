import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";

const webhookBodyLimit = 1024 * 1024;

export function registerClerkWebhook(
  server: FastifyInstance,
  webhook: (request: Request) => Promise<Response>
) {
  const rawBodies = new WeakMap<FastifyRequest, Buffer>();

  server.route({
    bodyLimit: webhookBodyLimit,
    handler: async (request, reply) => {
      const rawBody = rawBodies.get(request);
      if (!rawBody) {
        return reply.code(503).send("Webhook unavailable.");
      }
      const response = await webhook(
        new Request("http://tmterminal.local/api/webhooks/clerk", {
          body: rawBody.toString("utf8"),
          headers: standardHeaders(request.headers),
          method: "POST",
        })
      );
      response.headers.forEach((value, name) => {
        reply.header(name, value);
      });
      const body = await response.text();
      return reply.code(response.status).send(body || null);
    },
    method: "POST",
    preParsing: async (request, _reply, payload) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of payload) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > webhookBodyLimit) {
          throw Object.assign(new Error("Webhook body is too large."), { statusCode: 413 });
        }
        chunks.push(buffer);
      }
      const rawBody = Buffer.concat(chunks);
      rawBodies.set(request, rawBody);
      return Readable.from(rawBody);
    },
    url: "/api/webhooks/clerk",
  });
}

function standardHeaders(headers: FastifyRequest["headers"]) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
    } else if (value !== undefined) {
      result.set(name, value);
    }
  }
  return result;
}
