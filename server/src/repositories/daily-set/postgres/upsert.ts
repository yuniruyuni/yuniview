import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { DailySet } from "../../../models/daily-set";

export async function upsert(db: Database, m: DailySet): Promise<void> {
  // Every column is part of the key: a member is either recorded or not.
  await db.queryRun(
    sql`INSERT INTO daily_set_members(day,source,field,digest) VALUES(${m.day}::date,${m.source},${m.field},${m.digest}) ON CONFLICT DO NOTHING`,
  );
}
