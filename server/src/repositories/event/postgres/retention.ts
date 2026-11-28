import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { Batch } from "../../../models/batch";
import type { Claim } from "../../../models/retention";
import { claimToSQL } from "./common";

/**
 * About how many rows of `(from, to]` the claim decides, from the rows on a
 * random 1% of the table's pages. Counting them all reads every row the
 * claim decides, a second or more for a million rows; this reads a fixed
 * part of the table instead, within about a tenth over a day of rows.
 */
export async function estimate(
  db: Database,
  claim: Claim,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await db.queryAll<{ n: number }>(
    sql`SELECT (count(*)*100)::int AS n FROM telemetry_events TABLESAMPLE SYSTEM (1) WHERE at > ${from} AND at <= ${to} AND ${claimToSQL(claim)}`,
  );
  return row?.n ?? 0;
}

/** Deletes rows of `(from, to]` the claim decides; returns their batches. */
export async function sweep(
  db: Database,
  claim: Claim,
  from: Date,
  to: Date,
): Promise<{ deleted: number; batches: Batch.Key[] }> {
  const rows = await db.queryAll<{ source: string; id: string; n: number }>(
    sql`WITH gone AS (
  DELETE FROM telemetry_events WHERE at > ${from} AND at <= ${to} AND ${claimToSQL(claim)}
  RETURNING source,batch_id)
SELECT source,batch_id AS id,count(*)::int AS n FROM gone GROUP BY 1,2`,
  );
  return {
    deleted: rows.reduce((n, r) => n + r.n, 0),
    batches: rows.map(({ source, id }) => ({ source, id })),
  };
}

/**
 * The time of the oldest stored row, from each source's oldest by the
 * (source, at) index, instead of reading the table.
 */
export async function earliest(db: Database): Promise<Date | null> {
  const [row] = await db.queryAll<{ at: Date | null }>(
    sql`SELECT min((SELECT min(at) FROM telemetry_events WHERE source=s.id)) AS at FROM sources s`,
  );
  return row?.at ?? null;
}
