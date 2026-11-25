import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Batch } from "../../../models/batch";
import { batchSpecToSQL } from "./common";

export async function remove(db: Database, spec: Batch.Spec): Promise<number> {
  const where = compToSQL(spec, batchSpecToSQL);
  return (await db.queryRun(sql`DELETE FROM telemetry_batches WHERE ${where}`))
    .rowCount;
}
