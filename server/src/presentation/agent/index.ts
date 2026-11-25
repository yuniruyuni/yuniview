import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "../../usecases/context";
import { ingest } from "../../usecases/telemetry/ingest";

export const ingestPath = "/api/agent/v1/batches";
const status: Record<string, 400 | 401 | 403> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
};

export function agentRoutes(ctx: Context) {
  const route = new Hono();
  route.post(ingestPath, bodyLimit({ maxSize: 8 << 20 }), async (c) => {
    const auth = /^Bearer ([^\s]+)$/.exec(c.req.header("Authorization") ?? "");
    if (!auth) return c.body(null, 401);
    const body = await c.req.json().catch(() => null);
    const result = await ingest(auth[1], body).run({ ...ctx, now: new Date() });
    if (result.ok) return c.body(null, 204);
    return c.body(null, status[result.error.code] ?? 500);
  });
  return route;
}
