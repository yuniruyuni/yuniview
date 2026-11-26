import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import {
  afterCursor,
  compToSQL,
  lockClause,
  orderBy,
} from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import { Dashboard, type Versioned } from "../../../models/dashboard";
import {
  columnName,
  columnType,
  dashboardSpecToSQL,
  versioned,
} from "./common";

export async function list(
  db: Database,
  spec: Dashboard.Spec,
  cursor: Cursor<Dashboard.SortKey>,
): Promise<Page<Versioned<Dashboard>>> {
  const sort = cursor.sort ?? {
    keys: ["title", "id"] as const,
    order: "asc" as const,
  };
  const after = afterCursor(
    sort.keys,
    sort.order,
    cursor.after,
    columnName,
    columnType,
  );
  const rows = await db.queryAll<
    Versioned<Dashboard> & Record<string, unknown>
  >(
    sql`SELECT ${versioned} FROM dashboards WHERE ${compToSQL(spec, dashboardSpecToSQL)} AND ${after} ORDER BY ${orderBy(sort.keys, sort.order, columnName)} LIMIT ${cursor.limit + 1}${lockClause(cursor.lock)}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows
    .slice(0, cursor.limit)
    .map((r) => ({ ...r, definition: Dashboard.stored(r.definition) }));
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? { title: last.definition.title, id: last.definition.id }
        : undefined,
  };
}
