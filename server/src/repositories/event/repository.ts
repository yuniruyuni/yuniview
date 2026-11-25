import type { Cursor, Page } from "../../models/common";
import type { Event } from "../../models/event";
import type { DbReadCtx } from "../common/capability";

/**
 * Stored rows. Rows are written with their batch (see the batch repository),
 * so this repository only reads.
 */
export interface IEventRepository {
  list(
    ctx: DbReadCtx,
    spec: Event.Spec,
    cursor: Cursor<Event.SortKey>,
  ): Promise<Page<Event>>;
}
