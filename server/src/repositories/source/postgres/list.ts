import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { afterCursor, compToSQL } from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import type { Source } from "../../../models/source";
import { sourceSpecToSQL } from "./common";

export async function list(
  db: Database,
  spec: Source.Spec,
  cursor: Cursor<Source.SortKey>,
): Promise<Page<Source>> {
  const order = cursor.sort?.order ?? "asc";
  const after = afterCursor(
    ["id"] as const,
    order,
    cursor.after,
    () => sql`s.id`,
    () => sql`text`,
  );
  const rows = await db.queryAll<Source & Record<string, unknown>>(
    sql`SELECT s.id,(SELECT max(received_at) FROM telemetry_batches WHERE source_id=s.id) AS "lastReceived" FROM sources s WHERE ${compToSQL(spec, sourceSpecToSQL)} AND ${after} ORDER BY s.id ${sql.raw(order === "asc" ? "ASC" : "DESC")} LIMIT ${cursor.limit + 1}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? { id: last.id } : undefined,
  };
}
