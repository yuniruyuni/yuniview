import type {
  EventRow,
  Filter,
  Overview,
  Panel,
  Point,
  RouteRow,
  ShelfAxis,
  ShelfFields,
} from "../../../../shared/console";
import {
  cpuPercent,
  defaultTotalSlots,
  isAttribute,
  isTimeField,
  shelfFields,
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
function shelfKey(
  fields: ShelfFields,
  field: (axis: ShelfAxis) => ReturnType<typeof sql>,
) {
  const parts = shelfFields(fields).map(field);
  if (!parts.length) return sql`''::text`;
  if (parts.length === 1) return parts[0];
  return sql`ARRAY[${sql.join(parts, ",")}]::text[]`;
}
type GroupPoint = Omit<Point, "series" | "column" | "facet"> & {
  series: string | string[];
  column?: string | string[];
  facet?: string | string[];
};
function decodePoint(p: GroupPoint): Point {
  const { series, column, facet, ...rest } = p;
  return {
    ...rest,
    ...(Array.isArray(facet)
      ? { facet: JSON.stringify(facet), facetPath: facet }
      : { facet }),
    ...(Array.isArray(series)
      ? { series: JSON.stringify(series), rowPath: series }
      : { series }),
    ...(Array.isArray(column)
      ? { column: JSON.stringify(column), columnPath: column }
      : column !== undefined
        ? { column }
        : {}),
  };
}
export async function series(
  db: Database,
  p: Panel,
  end: Date,
  buckets: boolean,
) {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const distinct = p.measure === "distinct" ? p.distinct : undefined;
  if (distinct?.dataset === "daily") {
    const day = sql`day::text`;
    const dailyField = (key: ShelfAxis) => (key === "day" ? day : sql`source`);
    const row = shelfKey(pivot?.row ?? "source", dailyField);
    const count = sql`count(DISTINCT nullif(digest,''))::int`;
    return (
      await db.queryAll<GroupPoint>(
        sql`SELECT ${pivot ? sql`${end}::timestamptz` : sql`day::timestamp AT TIME ZONE 'Asia/Tokyo'`} AS bucket,${row} AS series,${pivot ? sql`${shelfKey(pivot.column, dailyField)} AS "column",` : sql``} ${count} AS value,${count} AS samples FROM daily_sets WHERE field=${distinct.field} AND day BETWEEN (${end}::timestamptz AT TIME ZONE 'Asia/Tokyo')::date - ${Math.ceil(p.minutes / 1440) - 1}::int AND (${end}::timestamptz AT TIME ZONE 'Asia/Tokyo')::date AND ${p.source ? sql`source=${p.source}` : sql`true`} GROUP BY ${pivot ? sql`1,2,3` : sql`1,2`} ORDER BY ${pivot ? sql`1,2,3` : sql`1,2`}`,
      )
    ).map(decodePoint);
  }
  if (p.group === "slot_total") {
    // Agents sample independently. Average within each minute before adding the two gauges.
    const slots = p.totalSlots ?? defaultTotalSlots;
    const bucket = buckets
      ? sql`date_bin(make_interval(mins=>${Math.ceil(p.minutes / 40)}::int),minute,'2000-01-01'::timestamptz)`
      : sql`${end}::timestamptz`;
    return db.queryAll<Point>(sql`
      WITH per_slot AS (
        SELECT date_trunc('minute', at) AS minute, source, workload, slot, avg(value) AS reading
        FROM telemetry_events WHERE ${matches(p, end)} AND kind='metric' AND name=${p.metric}
          AND value IS NOT NULL AND slot IN (${sql.list(slots)})
        GROUP BY 1,2,3,4
      ), totals AS (
        SELECT minute, source, workload, sum(reading) AS total FROM per_slot
        GROUP BY 1,2,3 HAVING count(*)=${slots.length}::int
      )
      SELECT ${bucket} AS bucket, source || '/' || workload AS series,
        ${sql.raw(p.aggregation)}(total) / ${p.unit === "MiB" ? 1048576 : 1}::float8 AS value,
        count(*)::int AS samples FROM totals GROUP BY 1,2 ORDER BY 1,2`);
  }
  const field = (key: ShelfAxis) =>
    isTimeField(key)
      ? sql`to_char(date_bin(make_interval(secs=>${Number(key.slice(5))}::int),at,'2000-01-01'::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`
      : isAttribute(key)
        ? sql`coalesce(attrs->>${key.slice(5)},'')`
        : key === "measure"
          ? p.measure === "metric"
            ? sql`name`
            : sql`${p.measure}::text`
          : key === "day"
            ? sql`(at AT TIME ZONE 'Asia/Tokyo')::date::text`
            : sql.raw(key);
  const group = pivot
    ? shelfKey(pivot.row, field)
    : p.group === "all"
      ? sql.raw("'all'::text")
      : field(p.group);
  const period =
    buckets && !pivot
      ? sql`date_bin(make_interval(secs=>${Math.max(1, Math.ceil((p.minutes * 60) / 40))}::int),at,'2000-01-01'::timestamptz)`
      : sql`${end}::timestamptz`;
  const filter = distinct
    ? sql`kind=${distinct.dataset}`
    : p.measure === "logs"
      ? sql.raw("kind='log'")
      : p.measure === "metric"
        ? sql`kind='metric' AND name IN (${sql.list([p.metric, ...(pivot?.metrics ?? [])])}) AND value IS NOT NULL`
        : sql.raw("kind='span' AND entry");
  const aggregate = distinct
    ? sql`count(DISTINCT nullif(attrs->>${distinct.field},''))`
    : p.measure === "latency"
      ? sql.raw("percentile_cont(0.95) WITHIN GROUP (ORDER BY value)")
      : p.measure === "errors"
        ? sql.raw("100.0*count(*) FILTER(WHERE failed)/count(*)")
        : p.measure === "metric"
          ? sql.raw(`${p.aggregation}(value)`)
          : sql.raw("count(*)");
  const units =
    pivot && p.measure === "metric" ? sql`min(unit) AS "metricUnit",` : sql``;
  const hasFacet = shelfFields(pivot?.series).length > 0;
  const wantsCpu =
    p.measure === "metric" &&
    [p.metric, ...(pivot?.metrics ?? [])].includes(cpuPercent);
  // Different containers have independent counters. Exclude counter resets and the first sample.
  const readings = wantsCpu
    ? sql`WITH counters AS (
    SELECT e.*, lag(value) OVER w AS prev, lag(at) OVER w AS prev_at
    FROM telemetry_events e WHERE ${matches(p, end)} AND kind='metric' AND name='cpu.usage'
    WINDOW w AS (PARTITION BY source, workload, instance, slot, revision ORDER BY at,batch_id,ordinal)
  ), readings AS (
    SELECT at,source,workload,instance,slot,revision,kind,name,body,attrs,value,unit,entry,failed FROM telemetry_events WHERE ${matches(p, end)} AND ${filter}
    UNION ALL SELECT at,source,workload,instance,slot,revision,kind,${cpuPercent},body,attrs,
    (value-prev)/(extract(epoch FROM at-prev_at)*10000), '%',entry,failed FROM counters WHERE at>prev_at AND value>=prev
  )`
    : sql``;
  const keys = hasFacet ? sql`1,2,3,4` : pivot ? sql`1,2,3` : sql`1,2`;
  return (
    await db.queryAll<GroupPoint>(
      sql`${readings} SELECT ${period} AS bucket,${group} AS series,${pivot ? sql`${shelfKey(pivot.column, field)} AS "column",` : sql``} ${hasFacet && pivot?.series ? sql`${shelfKey(pivot.series, field)} AS facet,` : sql``} ${units} (${aggregate}::float8 / ${p.unit === "MiB" ? 1048576 : 1}::float8) AS value,count(*)::int AS samples FROM ${wantsCpu ? sql.raw("readings") : sql.raw("telemetry_events")} WHERE ${matches(p, end)} AND ${filter} GROUP BY ${keys} HAVING ${aggregate} IS NOT NULL ORDER BY ${keys}`,
    )
  ).map(decodePoint);
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
    sql`SELECT DISTINCT 'metric' AS field,name AS item FROM telemetry_events WHERE kind='metric' UNION SELECT DISTINCT 'daily',field FROM daily_sets UNION SELECT DISTINCT 'slot',slot FROM telemetry_batches WHERE slot<>'' UNION SELECT DISTINCT 'revision',revision FROM telemetry_batches WHERE revision<>'' ORDER BY 1,2`,
  );
  const values = (key: string) =>
    options.filter((o) => o.field === key).map((o) => o.item);
  return {
    services,
    metrics: values("metric"),
    dailyFields: values("daily"),
    slots: values("slot"),
    revisions: values("revision"),
  };
}
