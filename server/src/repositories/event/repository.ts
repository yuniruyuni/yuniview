import type { Batch } from "../../models/batch";
import type { Cursor, Page } from "../../models/common";
import type { Event } from "../../models/event";
import type { Claim } from "../../models/retention";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

/**
 * Stored rows. Rows are written with their batch (see the batch repository);
 * here they are read, and deleted when a retention rule's period ends.
 */
export interface IEventRepository {
  list(
    ctx: DbReadCtx,
    spec: Event.Spec,
    cursor: Cursor<Event.SortKey>,
  ): Promise<Page<Event>>;
  /** Rows of `(from, to]` a retention rule decides. */
  count(ctx: DbReadCtx, claim: Claim, from: Date, to: Date): Promise<number>;
  /** Deletes rows of `(from, to]` a retention rule decides. */
  sweep(
    ctx: DbWriteCtx,
    claim: Claim,
    from: Date,
    to: Date,
  ): Promise<{ deleted: number; batches: Batch.Key[] }>;
  /** The time of the oldest stored row. */
  earliest(ctx: DbReadCtx): Promise<Date | null>;
}
