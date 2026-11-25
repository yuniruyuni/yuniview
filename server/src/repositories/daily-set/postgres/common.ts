import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { DailySet } from "../../../models/daily-set";
import { fieldCondition } from "../../common/field-sql";

type DailySetSpecData = Exclude<
  DailySet.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;

/** `field` is the set name's expression; legacy visit rows derive it. */
export function dailySetSpecToSQL(
  spec: DailySetSpecData,
  field: SQLFragment = sql`field`,
): SQLFragment {
  switch (spec.type) {
    case "Named":
      return sql`${field}=${spec.field}`;
    case "DayBetween":
      return sql`day BETWEEN ${spec.from}::date AND ${spec.to}::date`;
    case "Before":
      return sql`day < ${spec.day}::date`;
    case "Source":
      return sql`source=${spec.source}`;
    case "FieldIn":
    case "FieldRange":
    case "FieldMatches":
      return fieldCondition(spec);
  }
}
