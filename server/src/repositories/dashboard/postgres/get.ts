import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL, lockClause } from "../../../infra/db/sql-helpers";
import type { Lock } from "../../../models/common";
import { Dashboard, type Versioned } from "../../../models/dashboard";
import { dashboardSpecToSQL, versioned } from "./common";

export async function get(
  db: Database,
  spec: Dashboard.Spec,
  lock?: Lock,
): Promise<Versioned<Dashboard> | null> {
  const row = await db.queryGet<Versioned<Dashboard> & Record<string, unknown>>(
    sql`SELECT ${versioned} FROM dashboards WHERE ${compToSQL(spec, dashboardSpecToSQL)} LIMIT 1${lockClause(lock)}`,
  );
  return row && { ...row, definition: Dashboard.stored(row.definition) };
}
