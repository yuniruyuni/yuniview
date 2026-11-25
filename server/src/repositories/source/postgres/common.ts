import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Source } from "../../../models/source";

type SourceSpecData = Exclude<
  Source.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;
export function sourceSpecToSQL(spec: SourceSpecData): SQLFragment {
  switch (spec.type) {
    case "ById":
      return sql`s.id=${spec.id}`;
  }
}
