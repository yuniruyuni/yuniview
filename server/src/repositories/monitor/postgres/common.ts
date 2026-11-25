import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Monitor } from "../../../models/monitor";

type MonitorSpecData = Exclude<
  Monitor.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;
export function monitorSpecToSQL(spec: MonitorSpecData): SQLFragment {
  switch (spec.type) {
    case "ById":
      return sql`id=${spec.id}`;
    case "Due":
      return sql`(evaluated IS NULL OR evaluated<${spec.end})`;
  }
}
export function columnName(key: Monitor.SortKey): SQLFragment {
  return key === "title" ? sql`definition->>'title'` : sql`id`;
}
export function columnType(key: Monitor.SortKey): SQLFragment {
  return key === "title" ? sql`text` : sql`uuid`;
}
export const monitorColumns = sql.raw(
  "definition,state,evaluated,value,md5(definition::text) AS version",
);
