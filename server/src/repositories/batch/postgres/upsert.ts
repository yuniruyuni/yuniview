import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { Batch } from "../../../models/batch";

const chunk = 500;

export async function upsert(db: Database, b: Batch): Promise<void> {
  const s = b.source;
  // The payload is immutable; a repeated write only records indexing.
  await db.queryRun(sql`INSERT INTO telemetry_batches
    (source_id,batch_id,workload,instance,slot,revision,signal,observed_at,received_at,payload,indexed)
    VALUES (${s.service},${b.id},${s.workload},${s.instance},${s.slot ?? ""},${s.revision ?? ""},${b.signal},${b.time},${b.receivedAt},${JSON.stringify(b.payload)}::json,${b.indexed})
    ON CONFLICT (source_id,batch_id) DO UPDATE SET indexed=excluded.indexed
    WHERE telemetry_batches.indexed IS DISTINCT FROM excluded.indexed`);
  // Resources first, so no row refers to one that is not stored.
  if (b.resources.length)
    await db.queryRun(sql`INSERT INTO telemetry_resources (digest,attrs)
 SELECT decode(r.digest,'hex'),r.attrs FROM json_to_recordset(${JSON.stringify(b.resources)}::json) AS r(digest text,attrs json)
 ON CONFLICT DO NOTHING`);
  for (let i = 0; i < b.events.length; i += chunk) {
    const rows = b.events.slice(i, i + chunk).map((e) => ({
      ordinal: e.ordinal,
      at: e.at,
      kind: e.kind,
      name: e.name,
      body: e.body,
      trace: e.trace,
      span: e.span,
      parent: e.parent,
      value: e.value,
      unit: e.unit,
      failed: e.failed,
      entry: e.entry,
      attrs: e.attrs,
      resource: e.resource,
    }));
    await db.queryRun(sql`INSERT INTO telemetry_events
 (source,batch_id,workload,instance,slot,revision,ordinal,at,kind,name,body,trace,span,parent,value,unit,failed,entry,attrs,resource)
 SELECT ${s.service},${b.id},${s.workload},${s.instance},${s.slot ?? ""},${s.revision ?? ""},
  ordinal,at,kind,name,body,trace,span,parent,value,unit,failed,entry,attrs,decode(resource,'hex')
 FROM json_to_recordset(${JSON.stringify(rows)}::json) AS e(ordinal int,at timestamptz,kind text,name text,body text,trace text,span text,parent text,value double precision,unit text,failed boolean,entry boolean,attrs json,resource text)
 ON CONFLICT DO NOTHING`);
  }
}
