import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL, lockClause } from "../../../infra/db/sql-helpers";
import type { Cursor, Page } from "../../../models/common";
import type { FieldNote, FieldNoteChange } from "../../../models/dictionary";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IFieldNoteRepository } from "../repository";

type Leaf = Exclude<FieldNote.Spec, { type: "And" | "Or" | "Not" | "All" }>;
function specToSQL(spec: Leaf) {
  switch (spec.type) {
    case "ByKeys":
      return spec.keys.length
        ? sql`key IN (${sql.list([...spec.keys])})`
        : sql`false`;
  }
}

async function list(
  db: Database,
  spec: FieldNote.Spec,
  cursor: Cursor<FieldNote.SortKey>,
): Promise<Page<FieldNote>> {
  const rows = await db.queryAll<FieldNote & Record<string, unknown>>(
    sql`SELECT key,sender,person FROM fields WHERE ${compToSQL(spec, specToSQL)} ORDER BY key LIMIT ${cursor.limit + 1}${lockClause(cursor.lock)}`,
  );
  return {
    items: rows.slice(0, cursor.limit),
    hasMore: rows.length > cursor.limit,
  };
}

async function upsert(db: Database, change: FieldNoteChange) {
  if (change.sender)
    await db.queryRun(sql`INSERT INTO fields(key,sender) VALUES(${change.key},${JSON.stringify(change.sender)}::jsonb)
  ON CONFLICT(key) DO UPDATE SET sender=excluded.sender WHERE fields.sender IS DISTINCT FROM excluded.sender`);
  else
    await db.queryRun(sql`INSERT INTO fields(key,person) VALUES(${change.key},${JSON.stringify(change.person)}::jsonb)
  ON CONFLICT(key) DO UPDATE SET person=excluded.person`);
}

/** Notes on fields, kept in `fields`. */
export class FieldNoteRepository implements IFieldNoteRepository {
  async list(
    ctx: DbReadCtx,
    spec: FieldNote.Spec,
    cursor: Cursor<FieldNote.SortKey>,
  ): Promise<Page<FieldNote>> {
    return list(ctx.db, spec, cursor);
  }
  async upsert(ctx: DbWriteCtx, change: FieldNoteChange): Promise<void> {
    return upsert(ctx.db, change);
  }
}
