import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL, lockClause } from "../../../infra/db/sql-helpers";
import type { Lock } from "../../../models/common";
import type { Monitor, MonitorRecord } from "../../../models/monitor";
import { monitorColumns, monitorSpecToSQL } from "./common";

export async function get(
  db: Database,
  spec: Monitor.Spec,
  lock?: Lock,
): Promise<MonitorRecord | null> {
  return db.queryGet<MonitorRecord & Record<string, unknown>>(
    sql`SELECT ${monitorColumns} FROM monitors WHERE ${compToSQL(spec, monitorSpecToSQL)} LIMIT 1${lockClause(lock)}`,
  );
}
