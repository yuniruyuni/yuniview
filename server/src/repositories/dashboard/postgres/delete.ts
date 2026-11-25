import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Dashboard } from "../../../models/dashboard";
import { dashboardSpecToSQL } from "./common";

export async function remove(
  db: Database,
  spec: Dashboard.Spec,
): Promise<number> {
  return (
    await db.queryRun(
      sql`DELETE FROM dashboards WHERE ${compToSQL(spec, dashboardSpecToSQL)}`,
    )
  ).rowCount;
}
