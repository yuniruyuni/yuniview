import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { MonitorEvent } from "../../../models/monitor";

/** A state change is fixed once recorded; only its delivery progresses. */
export async function upsert(db: Database, e: MonitorEvent): Promise<void> {
  await db.queryRun(sql`INSERT INTO monitor_history(id,monitor_id,title,state,at,value,created_at,delivery,retry_at)
  VALUES(${e.id},${e.monitorId},${e.title},${e.state},${e.at},${e.value},${e.createdAt},${e.delivery},${e.retryAt})
  ON CONFLICT(id) DO UPDATE SET delivery=excluded.delivery,retry_at=excluded.retry_at`);
}
