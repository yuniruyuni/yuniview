import type { Cursor, Page } from "../../../models/common";
import type { MonitorEvent } from "../../../models/monitor";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IMonitorEventRepository } from "../repository";
import { list } from "./list";
import { upsert } from "./upsert";

export class MonitorEventRepository implements IMonitorEventRepository {
  async list(
    ctx: DbReadCtx,
    spec: MonitorEvent.Spec,
    cursor: Cursor<MonitorEvent.SortKey>,
  ): Promise<Page<MonitorEvent>> {
    return list(ctx.db, spec, cursor);
  }
  async upsert(ctx: DbWriteCtx, event: MonitorEvent): Promise<void> {
    return upsert(ctx.db, event);
  }
}
