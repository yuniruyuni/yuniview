import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL, lockClause } from "../../../infra/db/sql-helpers";
import type { Lock } from "../../../models/common";
import type { Dashboard, Versioned } from "../../../models/dashboard";
import { dashboardSpecToSQL, versioned } from "./common";

export async function get(
  db: Database,
  spec: Dashboard.Spec,
  lock?: Lock,
): Promise<Versioned<Dashboard> | null> {
  return db.queryGet<Versioned<Dashboard> & Record<string, unknown>>(
    sql`SELECT ${versioned} FROM dashboards WHERE ${compToSQL(spec, dashboardSpecToSQL)} LIMIT 1${lockClause(lock)}`,
  );
}
