import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { afterCursor, compToSQL, orderBy } from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import { Event } from "../../../models/event";
import {
  columnName,
  columnType,
  eventColumns,
  eventSpecToSQL,
  eventsWithResource,
} from "./common";

export async function list(
  db: Database,
  spec: Event.Spec,
  cursor: Cursor<Event.SortKey>,
): Promise<Page<Event>> {
  const where = compToSQL(spec, eventSpecToSQL);
  const sort = cursor.sort ?? { keys: Event.order, order: "desc" as const };
  const after = afterCursor(
    sort.keys,
    sort.order,
    cursor.after,
    columnName,
    columnType,
  );
  // No row locks: rows are only ever inserted, and the app may not update them.
  if (cursor.lock) throw Error("events are not locked");
  const rows = await db.queryAll<Event>(
    sql`SELECT ${eventColumns} FROM ${eventsWithResource} WHERE ${where} AND ${after} ORDER BY ${orderBy(sort.keys, sort.order, columnName)} LIMIT ${cursor.limit + 1}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? Event.cursor(last, sort.keys) : undefined,
  };
}
