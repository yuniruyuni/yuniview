import { randomUUID } from "node:crypto";
import type { Monitor, Point } from "../../../shared/console";
import { type Database, sql } from "../infra/db";
import { backfill, series } from "../repositories/console";

export function verdict(m: Monitor, points: Point[]) {
  const eligible = points.filter((p) => p.samples >= m.minimum);
  if (!eligible.length)
    return { state: m.missing === "alert" ? "alert" : "no_data", value: null };
  const value = eligible.reduce(
    (v, p) =>
      m.operator === "above" ? Math.max(v, p.value) : Math.min(v, p.value),
    eligible[0].value,
  );
  return {
    state: (m.operator === "above" ? value > m.threshold : value < m.threshold)
      ? "alert"
      : "ok",
    value,
  };
}
export async function evaluate(db: Database, now = new Date()) {
  const end = new Date(Math.floor(+now / 60000) * 60000);
  await db.transaction(async (tx) => {
    const rows = await tx.queryAll<{ definition: Monitor; state: string }>(
      sql`SELECT definition,state FROM monitors WHERE evaluated IS NULL OR evaluated<${end} ORDER BY id FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      const m = row.definition;
      const { state, value } = verdict(
        m,
        await series(tx, m.panel, end, false),
      );
      await tx.queryRun(
        sql`UPDATE monitors SET state=${state},value=${value},evaluated=${end} WHERE id=${m.id}`,
      );
      if (state !== row.state)
        await tx.queryRun(
          sql`INSERT INTO monitor_history(id,monitor_id,title,state,at,value,delivery) VALUES(${randomUUID()},${m.id},${m.title},${state},${end},${value},${m.notify ? "pending" : "off"})`,
        );
    }
  });
}
async function notify(db: Database, url: string) {
  const items = await db.queryAll<{
    id: string;
    title: string;
    state: string;
    at: Date;
    value: number | null;
  }>(
    sql`UPDATE monitor_history SET retry_at=now()+interval '1 minute' WHERE id IN(SELECT h.id FROM monitor_history h WHERE h.delivery='pending' AND h.retry_at<=now() AND NOT EXISTS (SELECT 1 FROM monitor_history older WHERE older.monitor_id=h.monitor_id AND older.delivery='pending' AND (older.created_at,older.id)<(h.created_at,h.id)) ORDER BY h.created_at LIMIT 5 FOR UPDATE OF h SKIP LOCKED) RETURNING id,title,state,at,value`,
  );
  for (const item of items) {
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": item.id,
        },
        body: JSON.stringify(item),
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel();
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      await db.queryRun(
        sql`UPDATE monitor_history SET delivery='sent' WHERE id=${item.id}`,
      );
    } catch (e) {
      console.error(
        "monitor webhook",
        item.id,
        e instanceof Error ? e.message : "failed",
      );
    }
  }
}
export function startWorker(db: Database) {
  const days = Number(process.env.TELEMETRY_RETENTION_DAYS ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 3650)
    throw Error("TELEMETRY_RETENTION_DAYS must be 0–3650");
  let nextCleanup = 0;
  let stopped = false;
  let running: Promise<void> | undefined;
  const tick = () => {
    if (stopped || running) return;
    running = (async () => {
      for (let i = 0; i < 16 && !stopped; i++) {
        if ((await backfill(db)) < 8) break;
      }
      await evaluate(db);
      if (days && Date.now() >= nextCleanup) {
        const cutoff = new Date(Date.now() - days * 86400000);
        await db.queryRun(
          sql`DELETE FROM telemetry_batches WHERE (source_id,batch_id) IN (SELECT source_id,batch_id FROM telemetry_batches WHERE received_at<${cutoff} ORDER BY received_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
        );
        nextCleanup = Date.now() + 60000;
      }
      if (process.env.MONITOR_WEBHOOK_URL)
        await notify(db, process.env.MONITOR_WEBHOOK_URL);
    })()
      .catch((e) => console.error("console worker", e))
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, 5000);
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}
