import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Batch } from "../../../models/batch";
import { batchSpecToSQL } from "./common";

/** Drops the payload of the batches the spec selects; keeps their rows. */
export async function dropPayloads(
  db: Database,
  spec: Batch.Spec,
): Promise<number> {
  const where = compToSQL(spec, batchSpecToSQL);
  return (
    await db.queryRun(
      sql`UPDATE telemetry_batches SET payload=NULL WHERE ${where} AND payload IS NOT NULL`,
    )
  ).rowCount;
}
