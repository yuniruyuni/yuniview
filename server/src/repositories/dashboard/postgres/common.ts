import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Dashboard } from "../../../models/dashboard";

type DashboardSpecData = Exclude<
  Dashboard.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;
export function dashboardSpecToSQL(spec: DashboardSpecData): SQLFragment {
  switch (spec.type) {
    case "ById":
      return sql`id=${spec.id}`;
  }
}
export function columnName(key: Dashboard.SortKey): SQLFragment {
  return key === "title" ? sql`definition->>'title'` : sql`id`;
}
export function columnType(key: Dashboard.SortKey): SQLFragment {
  return key === "title" ? sql`text` : sql`uuid`;
}
/** The edit version is a digest of the stored definition. */
export const versioned = sql.raw("definition,md5(definition::text) AS version");
