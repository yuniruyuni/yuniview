import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import {
  afterCursor,
  compToSQL,
  lockClause,
  orderBy,
} from "../../../infra/db/sql-helpers";
import type { Batch } from "../../../models/batch";
import type { Cursor, Page } from "../../../models/common";
import {
  type BatchRow,
  batchColumns,
  batchSpecToSQL,
  columnName,
  columnType,
  rowToBatch,
} from "./common";

export async function list(
  db: Database,
  spec: Batch.Spec,
  cursor: Cursor<Batch.SortKey>,
): Promise<Page<Batch>> {
  const where = compToSQL(spec, batchSpecToSQL);
  const sort = cursor.sort ?? {
    keys: ["receivedAt", "source", "id"] as const,
    order: "asc" as const,
  };
  const after = afterCursor(
    sort.keys,
    sort.order,
    cursor.after,
    columnName,
    columnType,
  );
  const rows = await db.queryAll<BatchRow>(
    sql`SELECT ${batchColumns} FROM telemetry_batches WHERE ${where} AND ${after} ORDER BY ${orderBy(sort.keys, sort.order, columnName)} LIMIT ${cursor.limit + 1}${lockClause(cursor.lock)}`,
  );
  const hasMore = rows.length > cursor.limit;
  const items = rows.slice(0, cursor.limit).map(rowToBatch);
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? Object.fromEntries(
            sort.keys.map((k) => [
              k,
              k === "receivedAt"
                ? last.receivedAt.toISOString()
                : k === "source"
                  ? last.source.service
                  : last.id,
            ]),
          )
        : undefined,
  };
}
