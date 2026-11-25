import type { Cursor, Lock, Page } from "../../../models/common";
import type { Monitor, MonitorRecord } from "../../../models/monitor";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IMonitorRepository } from "../repository";
import { remove } from "./delete";
import { get } from "./get";
import { list } from "./list";
import { upsert } from "./upsert";

export class MonitorRepository implements IMonitorRepository {
  async get(ctx: DbReadCtx, spec: Monitor.Spec, lock?: Lock) {
    return get(ctx.db, spec, lock);
  }
  async list(
    ctx: DbReadCtx,
    spec: Monitor.Spec,
    cursor: Cursor<Monitor.SortKey>,
  ): Promise<Page<MonitorRecord>> {
    return list(ctx.db, spec, cursor);
  }
  async upsert(ctx: DbWriteCtx, monitor: MonitorRecord) {
    return upsert(ctx.db, monitor);
  }
  async delete(ctx: DbWriteCtx, spec: Monitor.Spec) {
    return remove(ctx.db, spec);
  }
}
