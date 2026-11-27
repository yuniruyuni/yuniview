import type { Cursor, Page } from "../../../models/common";
import type { Event } from "../../../models/event";
import type { Claim } from "../../../models/retention";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IEventRepository } from "../repository";
import { list } from "./list";
import { count, earliest, sweep } from "./retention";

/** Stored log lines, spans, metric points and application events. */
export class EventRepository implements IEventRepository {
  async list(
    ctx: DbReadCtx,
    spec: Event.Spec,
    cursor: Cursor<Event.SortKey>,
  ): Promise<Page<Event>> {
    return list(ctx.db, spec, cursor);
  }
  async count(ctx: DbReadCtx, claim: Claim, from: Date, to: Date) {
    return count(ctx.db, claim, from, to);
  }
  async sweep(ctx: DbWriteCtx, claim: Claim, from: Date, to: Date) {
    return sweep(ctx.db, claim, from, to);
  }
  async earliest(ctx: DbReadCtx) {
    return earliest(ctx.db);
  }
}
