import type { Database } from "../../infra/db/database";
import { sql } from "../../infra/db/sql";
import type { Batch } from "../../models/telemetry";

export async function credential(db: Database, digest: string) {
  return db.queryGet<{ source_id: string; workload: string; slot: string }>(
    sql`SELECT source_id, workload, slot FROM agent_credentials WHERE token_sha256 = ${digest}`,
  );
}

export async function storeBatch(db: Database, batch: Batch) {
  const s = batch.source;
  await db.queryRun(sql`INSERT INTO telemetry_batches
    (source_id, batch_id, workload, instance, slot, revision, signal, observed_at, payload)
    VALUES (${s.service}, ${batch.id}, ${s.workload}, ${s.instance}, ${s.slot ?? ""}, ${s.revision ?? ""}, ${batch.signal}, ${batch.time}, ${JSON.stringify(batch.payload)}::json)
    ON CONFLICT (source_id, batch_id) DO NOTHING`);
}
