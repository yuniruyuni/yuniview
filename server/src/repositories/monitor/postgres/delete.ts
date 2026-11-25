import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Monitor } from "../../../models/monitor";
import { monitorSpecToSQL } from "./common";

export async function remove(
  db: Database,
  spec: Monitor.Spec,
): Promise<number> {
  return (
    await db.queryRun(
      sql`DELETE FROM monitors WHERE ${compToSQL(spec, monitorSpecToSQL)}`,
    )
  ).rowCount;
}
