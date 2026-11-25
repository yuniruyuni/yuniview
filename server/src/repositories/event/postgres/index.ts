import type { Cursor, Page } from "../../../models/common";
import type { Event } from "../../../models/event";
import type { DbReadCtx } from "../../common/capability";
import type { IEventRepository } from "../repository";
import { list } from "./list";

/**
 * Stored rows. `analysis_events` presents application events together with
 * routed server spans counted as `http.request` occurrences.
 */
export class EventRepository implements IEventRepository {
  constructor(private readonly table: "telemetry_events" | "analysis_events") {}
  async list(
    ctx: DbReadCtx,
    spec: Event.Spec,
    cursor: Cursor<Event.SortKey>,
  ): Promise<Page<Event>> {
    return list(ctx.db, this.table, spec, cursor);
  }
}
