import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import {
  afterCursor,
  compToSQL,
  lockClause,
  orderBy,
} from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import type { Monitor, MonitorRecord } from "../../../models/monitor";
import {
  columnName,
  columnType,
  monitorColumns,
  monitorSpecToSQL,
} from "./common";

export async function list(
  db: Database,
  spec: Monitor.Spec,
  cursor: Cursor<Monitor.SortKey>,
): Promise<Page<MonitorRecord>> {
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
  const rows = await db.queryAll<MonitorRecord & Record<string, unknown>>(
    sql`SELECT ${monitorColumns} FROM monitors WHERE ${compToSQL(spec, monitorSpecToSQL)} AND ${after} ORDER BY ${orderBy(sort.keys, sort.order, columnName)} LIMIT ${cursor.limit + 1}${lockClause(cursor.lock)}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit);
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
