import { type SQLFragment, sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type {
  Aggregate,
  Having,
  Measure,
  Relation,
} from "../../../models/aggregate";
import type { Event } from "../../../models/event";
import { batchSpecToSQL } from "../../batch/postgres/common";
import { alias, column, label, observed } from "../../common/field-sql";
import { dailySetSpecToSQL } from "../../daily-set/postgres/common";
import { eventSpecToSQL } from "../../event/postgres/common";

const events = (spec: Event.Spec) => compToSQL(spec, eventSpecToSQL);

/** Rows of a relation: what to read and which of its rows count. */
export function relationToSQL(r: Relation): {
  from: SQLFragment;
  where: SQLFragment;
} {
  switch (r.type) {
    case "events":
      return { from: sql`telemetry_events`, where: events(r.where) };
    case "rates":
      // Each container has its own counter: skip its first sample and resets.
      return {
        from: sql`(SELECT at,source,workload,instance,slot,revision,kind,name,body,attrs,trace,
    (value-prev)/extract(epoch FROM at-prev_at) AS value,unit||'/s' AS unit,entry,failed
  FROM (SELECT e.*, lag(value) OVER w AS prev, lag(at) OVER w AS prev_at
    FROM telemetry_events e WHERE ${events(r.where)}
    WINDOW w AS (PARTITION BY source, workload, instance, slot, revision, name ORDER BY at,batch_id,ordinal)) counters
  WHERE at>prev_at AND value>=prev) rates`,
        where: sql`true`,
      };
    case "daily_sets":
      return {
        from: sql`daily_sets`,
        where: compToSQL(r.where, (s) => dailySetSpecToSQL(s)),
      };
    case "batches":
      return {
        from: sql`telemetry_batches`,
        where: compToSQL(r.where, batchSpecToSQL),
      };
    case "attribute_keys":
      return {
        from: sql`(SELECT a.key FROM (
      SELECT attrs FROM telemetry_events WHERE ${events(r.where)} ORDER BY at DESC LIMIT ${r.sample}::int
    ) sample CROSS JOIN LATERAL json_each(sample.attrs) a WHERE json_typeof(a.value) IN ('string','number','boolean') AND length(a.key) BETWEEN 1 AND 256) keys`,
        where: sql`true`,
      };
    case "aggregate":
      return { from: sql`(${aggregateToSQL(r.of)}) cells`, where: sql`true` };
  }
}

const fns = new Set(["avg", "max", "min", "sum"]);
function filtered(expr: SQLFragment, where?: Event.Spec) {
  return where ? sql`${expr} FILTER(WHERE ${events(where)})` : expr;
}

export function measureToSQL(m: Measure): SQLFragment {
  switch (m.type) {
    case "count":
      return filtered(sql`count(*)`, m.where);
    case "percent":
      return sql`100.0*${filtered(sql`count(*)`, m.where)}/count(*)`;
    case "aggregate":
      if (!fns.has(m.fn)) throw Error(`invalid aggregate ${m.fn}`);
      return sql`${sql.raw(m.fn)}(${column(m.of)})`;
    case "percentile":
      return filtered(
        sql`percentile_cont(${sql.raw(String(Number(m.fraction)))}) WITHIN GROUP (ORDER BY ${column(m.of)})`,
        m.where,
      );
    case "distinct":
      if (m.of.type === "tuple") {
        const parts = m.of.fields.map((f) => sql`${label(f)}<>''`);
        return sql`count(DISTINCT CASE WHEN ${sql.join(parts, " AND ")} THEN ${label(m.of)} END)`;
      }
      return sql`count(DISTINCT nullif(${label(m.of)},''))`;
    case "uniform":
      return sql`CASE WHEN min(${column(m.of)})=max(${column(m.of)}) THEN min(${column(m.of)}) END`;
    case "slowest_trace":
      return sql`(array_agg(trace ORDER BY value DESC NULLS LAST) FILTER(WHERE trace<>''))[1]`;
    case "numeric": {
      const { text, num } = observed(m.of);
      return sql`coalesce(bool_and(${num} IS NOT NULL) FILTER(WHERE ${text} IS NOT NULL),false)`;
    }
    case "bound":
      return sql`${sql.raw(m.fn === "min" ? "min" : "max")}(${observed(m.of).num})`;
    case "scaled":
      return sql`(${measureToSQL(m.measure)}::float8 / ${m.by}::float8)`;
  }
}

function havingToSQL(h: Having): SQLFragment {
  return h.type === "present"
    ? sql`${measureToSQL(h.measure)} IS NOT NULL`
    : sql`count(*)=${h.count}::int`;
}

/** The aggregate as a query without order or limit. */
export function aggregateToSQL(a: Aggregate): SQLFragment {
  const { from, where } = relationToSQL(a.from);
  const columns = [
    ...a.by.map((g) => sql`${label(g.field)} AS ${alias(g.as)}`),
    ...a.measures.map((o) => {
      const expr = measureToSQL(o.measure);
      return sql`${o.cast ? sql`(${expr})::${sql.raw(o.cast)}` : expr} AS ${alias(o.as)}`;
    }),
  ];
  const groups = a.by.length
    ? sql` GROUP BY ${sql.raw(a.by.map((_, i) => i + 1).join(","))}`
    : sql``;
  const having = a.having ? sql` HAVING ${havingToSQL(a.having)}` : sql``;
  return sql`SELECT ${sql.join(columns, ",")} FROM ${from} WHERE ${where}${groups}${having}`;
}
