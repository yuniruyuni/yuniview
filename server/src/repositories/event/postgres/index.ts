import type { Cursor, Page } from "../../../models/common";
import type { Event } from "../../../models/event";
import type { DbReadCtx } from "../../common/capability";
import type { IEventRepository } from "../repository";
import { list } from "./list";

/** Stored log lines, spans, metric points and application events. */
export class EventRepository implements IEventRepository {
  async list(
    ctx: DbReadCtx,
    spec: Event.Spec,
    cursor: Cursor<Event.SortKey>,
  ): Promise<Page<Event>> {
    return list(ctx.db, spec, cursor);
  }
}
