import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Event } from "../../../models/event";
import { fieldCondition } from "../../common/field-sql";

type EventSpecData = Event.Spec extends infer S
  ? S extends { type: string }
    ? Exclude<S, { type: "And" | "Or" | "Not" | "All" }>
    : never
  : never;

export type { EventSpecData };

export function eventSpecToSQL(spec: EventSpecData): SQLFragment {
  switch (spec.type) {
    case "Window":
      return sql`at > ${spec.from} AND at <= ${spec.to}`;
    case "FieldIn":
    case "FieldRange":
    case "FieldMatches":
      return fieldCondition(spec);
    case "Kind":
      return sql`kind=${spec.kind}`;
    case "Entry":
      return sql`entry`;
    case "Failed":
      return sql`failed`;
    case "Named":
      return spec.names.length
        ? sql`name IN (${sql.list([...spec.names])})`
        : sql`false`;
    case "HasValue":
      return sql`value IS NOT NULL`;
    case "Text":
      return sql`(strpos(lower(body),lower(${spec.text}))>0 OR strpos(lower(name),lower(${spec.text}))>0)`;
    case "Trace":
      return sql`trace=${spec.trace}`;
  }
}

/**
 * The table's column, qualified: {@link eventColumns} names its text `at`,
 * and ORDER BY a bare `at` would sort that text instead of using the index.
 */
export function columnName(key: Event.SortKey): SQLFragment {
  const name = {
    at: "at",
    source: "source",
    batchId: "batch_id",
    ordinal: "ordinal",
  }[key];
  return sql.raw(`telemetry_events.${name}`);
}
export function columnType(key: Event.SortKey): SQLFragment {
  return sql.raw(
    { at: "timestamptz", source: "text", batchId: "text", ordinal: "int" }[key],
  );
}

/** Columns of an {@link Event}. `at` keeps microseconds for cursors. */
export const eventColumns = sql.raw(
  `concat(source,'/',batch_id,'/',ordinal) AS id,batch_id AS "batchId",ordinal,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,source,instance,workload,slot,revision,kind,name,body,trace,span,parent,value,unit,failed,entry,attrs`,
);
