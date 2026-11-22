import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { sql } from "../../infra/db";
import type { Database } from "../../infra/db/database";
import { batchSchema, usageMark } from "../../models/telemetry";
import { credential, storeBatch } from "../../repositories/telemetry";

export const ingestPath = "/api/agent/v1/batches";
export function agentRoutes(db: Database) {
  const route = new Hono();
  route.post(ingestPath, bodyLimit({ maxSize: 8 << 20 }), async (c) => {
    const auth = /^Bearer ([^\s]+)$/.exec(c.req.header("Authorization") ?? "");
    if (!auth) return c.body(null, 401);
    const digest = createHash("sha256").update(auth[1]).digest("hex");
    const binding = await credential(db, digest);
    if (!binding) return c.body(null, 401);
    const result = batchSchema.safeParse(await c.req.json().catch(() => null));
    if (!result.success) return c.body(null, 400);
    const batch = result.data;
    if (
      batch.source.service !== binding.source_id ||
      batch.source.workload !== binding.workload ||
      (batch.source.slot ?? "") !== binding.slot
    )
      return c.body(null, 403);
    if (batch.signal === "usage") {
      const mark = usageMark.safeParse(batch.payload);
      if (!mark.success) return c.body(null, 400);
      const { day, kind, digest } = mark.data;
      await db.queryRun(
        sql`INSERT INTO daily_visitors(day,source,kind,digest) VALUES(${day}::date,${binding.source_id},${kind},${digest}) ON CONFLICT DO NOTHING`,
      );
      return c.body(null, 204);
    }
    await storeBatch(db, batch);
    return c.body(null, 204);
  });
  return route;
}
