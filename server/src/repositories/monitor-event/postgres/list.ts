import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import {
  afterCursor,
  compToSQL,
  lockClause,
  orderBy,
} from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import type { MonitorEvent } from "../../../models/monitor";
import { columnName, columnType, monitorEventSpecToSQL } from "./common";

export async function list(
  db: Database,
  spec: MonitorEvent.Spec,
  cursor: Cursor<MonitorEvent.SortKey>,
): Promise<Page<MonitorEvent>> {
  const sort = cursor.sort ?? {
    keys: ["createdAt", "id"] as const,
    order: "desc" as const,
  };
  const after = afterCursor(
    sort.keys,
    sort.order,
    cursor.after,
    columnName,
    columnType,
  );
  const rows = await db.queryAll<MonitorEvent & Record<string, unknown>>(
    sql`SELECT id,monitor_id AS "monitorId",title,state,at,value,created_at AS "createdAt",delivery,retry_at AS "retryAt" FROM monitor_history WHERE ${compToSQL(spec, monitorEventSpecToSQL)} AND ${after} ORDER BY ${orderBy(sort.keys, sort.order, columnName)} LIMIT ${cursor.limit + 1}${lockClause(cursor.lock)}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? { createdAt: last.createdAt.toISOString(), id: last.id }
        : undefined,
  };
}
