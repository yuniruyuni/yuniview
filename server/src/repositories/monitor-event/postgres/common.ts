import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { MonitorEvent } from "../../../models/monitor";

type MonitorEventSpecData = Exclude<
  MonitorEvent.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;
export function monitorEventSpecToSQL(spec: MonitorEventSpecData): SQLFragment {
  switch (spec.type) {
    case "Deliverable":
      return sql`delivery='pending' AND retry_at<=${spec.now} AND NOT EXISTS (SELECT 1 FROM monitor_history older WHERE older.monitor_id=monitor_history.monitor_id AND older.delivery='pending' AND (older.created_at,older.id)<(monitor_history.created_at,monitor_history.id))`;
    case "ByIds":
      return spec.ids.length ? sql`id IN (${sql.list(spec.ids)})` : sql`false`;
  }
}
export function columnName(key: MonitorEvent.SortKey): SQLFragment {
  return key === "createdAt" ? sql`created_at` : sql`id`;
}
export function columnType(key: MonitorEvent.SortKey): SQLFragment {
  return key === "createdAt" ? sql`timestamptz` : sql`uuid`;
}
