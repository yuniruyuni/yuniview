import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { MonitorRecord } from "../../../models/monitor";

export async function upsert(db: Database, m: MonitorRecord): Promise<void> {
  const d = m.definition;
  await db.queryRun(sql`INSERT INTO monitors(id,definition,state,evaluated,value)
  VALUES(${d.id},${JSON.stringify(d)}::jsonb,${m.state},${m.evaluated},${m.value})
  ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,state=excluded.state,evaluated=excluded.evaluated,value=excluded.value`);
}
