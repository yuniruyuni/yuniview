import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { DailySet } from "../../../models/daily-set";
import { dailySetSpecToSQL } from "./common";

export async function remove(
  db: Database,
  spec: DailySet.Spec,
): Promise<number> {
  // Visits stored by agents of the previous release are members too.
  const legacy = await db.queryRun(
    sql`DELETE FROM daily_visitors WHERE ${compToSQL(spec, (s) => dailySetSpecToSQL(s, sql`('visit.' || kind)`))}`,
  );
  const current = await db.queryRun(
    sql`DELETE FROM daily_set_members WHERE ${compToSQL(spec, (s) => dailySetSpecToSQL(s))}`,
  );
  return legacy.rowCount + current.rowCount;
}
