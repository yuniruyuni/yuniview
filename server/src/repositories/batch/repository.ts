import type { Batch } from "../../models/batch";
import type { Cursor, Page } from "../../models/common";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IBatchRepository {
  list(
    ctx: DbReadCtx,
    spec: Batch.Spec,
    cursor: Cursor<Batch.SortKey>,
  ): Promise<Page<Batch>>;
  count(ctx: DbReadCtx, spec: Batch.Spec): Promise<number>;
  /** Stores the batch once, then its indexed rows and flag. */
  upsert(ctx: DbWriteCtx, batch: Batch): Promise<void>;
  /** Deletes batches together with their rows. */
  delete(ctx: DbWriteCtx, spec: Batch.Spec): Promise<number>;
  /** Drops the payload of batches, keeping them and their rows. */
  dropPayloads(ctx: DbWriteCtx, spec: Batch.Spec): Promise<number>;
}
