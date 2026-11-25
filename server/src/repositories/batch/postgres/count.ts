import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Batch } from "../../../models/batch";
import { batchSpecToSQL } from "./common";

export async function count(db: Database, spec: Batch.Spec): Promise<number> {
  const row = await db.queryGet<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM telemetry_batches WHERE ${compToSQL(spec, batchSpecToSQL)}`,
  );
  return row?.n ?? 0;
}
