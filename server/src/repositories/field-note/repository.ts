import type { Cursor, Page } from "../../models/common";
import type { FieldNote, FieldNoteChange } from "../../models/dictionary";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IFieldNoteRepository {
  list(
    ctx: DbReadCtx,
    spec: FieldNote.Spec,
    cursor: Cursor<FieldNote.SortKey>,
  ): Promise<Page<FieldNote>>;
  /** Writes the sender's or the person's part of a note, never both. */
  upsert(ctx: DbWriteCtx, change: FieldNoteChange): Promise<void>;
}
