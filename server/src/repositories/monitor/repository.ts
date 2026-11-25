import type { Cursor, Lock, Page } from "../../models/common";
import type { Monitor, MonitorRecord } from "../../models/monitor";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IMonitorRepository {
  get(
    ctx: DbReadCtx,
    spec: Monitor.Spec,
    lock?: Lock,
  ): Promise<MonitorRecord | null>;
  list(
    ctx: DbReadCtx,
    spec: Monitor.Spec,
    cursor: Cursor<Monitor.SortKey>,
  ): Promise<Page<MonitorRecord>>;
  upsert(ctx: DbWriteCtx, monitor: MonitorRecord): Promise<void>;
  delete(ctx: DbWriteCtx, spec: Monitor.Spec): Promise<number>;
}
