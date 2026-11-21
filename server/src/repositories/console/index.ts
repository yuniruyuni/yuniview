import type {
  EventRow,
  Filter,
  Overview,
  Panel,
  Point,
  RouteRow,
} from "../../../../shared/console";
import type { Database } from "../../infra/db";
import { sql } from "../../infra/db";
import { events } from "../../models/events";
import type { Batch } from "../../models/telemetry";

export async function indexBatch(db: Database, b: Batch) {
  const data = Array.from(events(b));
  for (let i = 0; i < data.length; i += 500) {
    const chunk = data
      .slice(i, i + 500)
      .map((event, j) => ({ ...event, ordinal: i + j }));
    await db.queryRun(sql`INSERT INTO telemetry_events
 (source,batch_id,workload,instance,slot,revision,ordinal,at,kind,name,body,trace,span,parent,value,unit,failed,entry,attrs)
 SELECT ${b.source.service},${b.id},${b.source.workload},${b.source.instance},${b.source.slot ?? ""},${b.source.revision ?? ""},*
 FROM json_to_recordset(${JSON.stringify(chunk)}::json) AS e(ordinal int,at timestamptz,kind text,name text,body text,trace text,span text,parent text,value double precision,unit text,failed boolean,entry boolean,attrs json)`);
  }
  await db.queryRun(
    sql`UPDATE telemetry_batches SET indexed=true WHERE source_id=${b.source.service} AND batch_id=${b.id}`,
  );
}
export async function backfill(db: Database) {
  return db.transaction(async (tx) => {
    const batches =
      await tx.queryAll<Batch>(sql`SELECT batch_id AS id,signal,observed_at::text AS time,payload,
 json_build_object('service',source_id,'instance',instance,'workload',workload,'revision',revision,'slot',slot) AS source
 FROM telemetry_batches WHERE NOT indexed ORDER BY received_at LIMIT 8 FOR UPDATE SKIP LOCKED`);
    for (const batch of batches) await indexBatch(tx, batch);
    return batches.length;
  });
}
function matches(f: Filter, end: Date) {
  const parts = [
    sql`at > ${new Date(end.getTime() - 60000 * f.minutes)} AND at <= ${end}`,
  ];
  if (f.source) parts.push(sql`source=${f.source}`);
  if (f.instance) parts.push(sql`instance=${f.instance}`);
  if (f.workload) parts.push(sql`workload=${f.workload}`);
  if (f.slot) parts.push(sql`slot=${f.slot}`);
  if (f.revision) parts.push(sql`revision=${f.revision}`);
  if (f.text)
    parts.push(
      sql`(strpos(lower(body),lower(${f.text}))>0 OR strpos(lower(name),lower(${f.text}))>0)`,
    );
  return sql.join(parts, " AND ");
}
export async function series(
  db: Database,
  p: Panel,
  end: Date,
  buckets: boolean,
) {
  const group = p.group === "all" ? sql.raw("'all'::text") : sql.raw(p.group);
  const period = buckets
    ? sql`date_bin(make_interval(secs=>${Math.max(1, Math.ceil((p.minutes * 60) / 40))}::int),at,'2000-01-01'::timestamptz)`
    : sql`${end}::timestamptz`;
  const filter =
    p.measure === "logs"
      ? sql.raw("kind='log'")
      : p.measure === "metric"
        ? sql`kind='metric' AND name=${p.metric} AND value IS NOT NULL`
        : sql.raw("kind='span' AND entry");
  const aggregate =
    p.measure === "latency"
      ? sql.raw("percentile_cont(0.95) WITHIN GROUP (ORDER BY value)")
      : p.measure === "errors"
        ? sql.raw("100.0*count(*) FILTER(WHERE failed)/count(*)")
        : p.measure === "metric"
          ? sql.raw(`${p.aggregation}(value)`)
          : sql.raw("count(*)");
  return db.queryAll<Point>(
    sql`SELECT ${period} AS bucket,${group} AS series,${aggregate}::float8 AS value,count(*)::int AS samples FROM telemetry_events WHERE ${matches(p, end)} AND ${filter} GROUP BY 1,2 HAVING ${aggregate} IS NOT NULL ORDER BY 1,2`,
  );
}
const columns = sql.raw(
  "concat(source,'/',batch_id,'/',ordinal) AS id,at,source,instance,workload,slot,revision,kind,name,body,trace,span,parent,value,unit,failed,attrs",
);
export async function listEvents(
  db: Database,
  f: Filter,
  kind: string,
  end: Date,
  offset: number,
) {
  return db.queryAll<EventRow>(
    sql`SELECT ${columns} FROM telemetry_events WHERE ${matches(f, end)} AND kind=${kind} ORDER BY at DESC, source,batch_id,ordinal LIMIT 101 OFFSET ${offset}`,
  );
}
export async function traceDetails(db: Database, id: string) {
  return db.queryAll<EventRow>(
    sql`SELECT ${columns} FROM telemetry_events WHERE trace=${id} ORDER BY at,source,batch_id,ordinal LIMIT 2001`,
  );
}
export async function routes(db: Database, f: Filter, end: Date) {
  return db.queryAll<RouteRow>(
    sql`SELECT source,name,count(*)::int AS requests,count(*) FILTER(WHERE failed)::int AS errors,percentile_cont(0.95) WITHIN GROUP(ORDER BY value) AS p95,(array_agg(trace ORDER BY value DESC NULLS LAST) FILTER(WHERE trace<>''))[1] AS trace FROM telemetry_events WHERE ${matches(f, end)} AND kind='span' AND entry GROUP BY source,name ORDER BY requests DESC LIMIT 200`,
  );
}
export async function overview(
  db: Database,
  f: Filter,
  end: Date,
): Promise<Overview> {
  const services = await db.queryAll<
    Overview["services"][number]
  >(sql`WITH stats AS (SELECT source,count(*) FILTER(WHERE entry)::int AS requests,count(*) FILTER(WHERE entry AND failed)::int AS errors,percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FILTER(WHERE entry) AS latency FROM telemetry_events WHERE ${matches(f, end)} GROUP BY source)
 SELECT s.id AS source,(SELECT max(received_at) FROM telemetry_batches WHERE source_id=s.id) AS last,coalesce(requests,0) AS requests,coalesce(errors,0) AS errors,latency FROM sources s LEFT JOIN stats ON stats.source=s.id ORDER BY s.id`);
  const options = await db.queryAll<{ field: string; item: string }>(
    sql`SELECT DISTINCT 'metric' AS field,name AS item FROM telemetry_events WHERE kind='metric' UNION SELECT DISTINCT 'slot',slot FROM telemetry_batches WHERE slot<>'' UNION SELECT DISTINCT 'revision',revision FROM telemetry_batches WHERE revision<>'' ORDER BY 1,2`,
  );
  const values = (key: string) =>
    options.filter((o) => o.field === key).map((o) => o.item);
  return {
    services,
    metrics: values("metric"),
    slots: values("slot"),
    revisions: values("revision"),
  };
}
