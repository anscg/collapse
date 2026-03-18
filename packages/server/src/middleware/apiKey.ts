import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";

if (!process.env.INTERNAL_API_KEY) {
  throw new Error(
    "INTERNAL_API_KEY environment variable is required but not set",
  );
}
const INTERNAL_API_KEY: string = process.env.INTERNAL_API_KEY;

export async function requireApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const key = request.headers["x-api-key"];
  if (
    typeof key !== "string" ||
    key.length !== INTERNAL_API_KEY.length ||
    !timingSafeEqual(Buffer.from(key), Buffer.from(INTERNAL_API_KEY))
  ) {
    return reply.code(401).send({ error: "Invalid API key" });
  }
}
