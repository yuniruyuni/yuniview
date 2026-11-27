import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Batch } from "../../../models/batch";

type BatchSpecData = Exclude<
  Batch.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;

export function batchSpecToSQL(spec: BatchSpecData): SQLFragment {
  switch (spec.type) {
    case "ByKeys":
      return spec.keys.length
        ? sql`(source_id,batch_id) IN (${sql.join(
            spec.keys.map((k) => sql`(${k.source}::text,${k.id}::text)`),
            ",",
          )})`
        : sql`false`;
    case "Pending":
      return sql`NOT indexed`;
    case "OldestBefore":
      return sql`(source_id,batch_id) IN (SELECT source_id,batch_id FROM telemetry_batches WHERE received_at<${spec.at} ORDER BY received_at LIMIT ${spec.count}::int FOR UPDATE SKIP LOCKED)`;
    case "Slot":
      return sql`slot=${spec.slot}`;
    case "Revision":
      return sql`revision=${spec.revision}`;
  }
}

export function columnName(key: Batch.SortKey): SQLFragment {
  return sql.raw(
    { receivedAt: "received_at", source: "source_id", id: "batch_id" }[key],
  );
}
export function columnType(key: Batch.SortKey): SQLFragment {
  return sql.raw(key === "receivedAt" ? "timestamptz" : "text");
}

export interface BatchRow {
  id: string;
  signal: Batch["signal"];
  time: string;
  payload: Batch["payload"];
  source: Batch["source"];
  receivedAt: Date;
  indexed: boolean;
}
export const batchColumns =
  sql.raw(`batch_id AS id,signal,observed_at::text AS time,payload,
 json_build_object('service',source_id,'instance',instance,'workload',workload,'revision',revision,'slot',slot) AS source,
 received_at AS "receivedAt",indexed`);

export function rowToBatch(row: BatchRow): Batch {
  return { ...row, events: [], resources: [], fields: [] };
}
