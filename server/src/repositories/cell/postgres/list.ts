import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import type { Cell } from "../../../models/aggregate";
import type { Cursor, Page } from "../../../models/common";
import { alias } from "../../common/field-sql";
import { aggregateToSQL } from "./common";

/**
 * Cells ordered by the sort keys, then by every group. Continuing after a
 * cursor is not supported: callers read the first page.
 */
export async function list(
  db: Database,
  spec: Cell.Spec,
  cursor: Cursor<Cell.SortKey>,
): Promise<Page<Cell>> {
  const groups = spec.by.map((g) => g.as);
  const sort = cursor.sort ?? { keys: groups, order: "asc" as const };
  const dir = sql.raw(sort.order === "asc" ? "ASC" : "DESC");
  const keys = [...sort.keys, ...groups.filter((g) => !sort.keys.includes(g))];
  const order = keys.length
    ? sql` ORDER BY ${sql.join(
        keys.map((k) =>
          sort.keys.includes(k)
            ? sql`${alias(k)} ${dir}`
            : sql`${alias(k)} ASC`,
        ),
        ", ",
      )}`
    : sql``;
  const rows = await db.queryAll<Cell>(
    sql`${aggregateToSQL(spec)}${order} LIMIT ${cursor.limit + 1}`,
  );
  return {
    items: rows.slice(0, cursor.limit),
    hasMore: rows.length > cursor.limit,
  };
}
