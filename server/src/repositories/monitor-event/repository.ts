import type { Cursor, Page } from "../../models/common";
import type { MonitorEvent } from "../../models/monitor";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IMonitorEventRepository {
  list(
    ctx: DbReadCtx,
    spec: MonitorEvent.Spec,
    cursor: Cursor<MonitorEvent.SortKey>,
  ): Promise<Page<MonitorEvent>>;
  upsert(ctx: DbWriteCtx, event: MonitorEvent): Promise<void>;
}
