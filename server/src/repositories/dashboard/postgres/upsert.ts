import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { Dashboard } from "../../../models/dashboard";

export async function upsert(db: Database, d: Dashboard): Promise<void> {
  await db.queryRun(sql`INSERT INTO dashboards(id,definition) VALUES(${d.id},${JSON.stringify(d)}::jsonb)
  ON CONFLICT(id) DO UPDATE SET definition=excluded.definition`);
}
