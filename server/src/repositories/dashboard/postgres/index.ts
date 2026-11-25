import type { Cursor, Lock, Page } from "../../../models/common";
import type { Dashboard, Versioned } from "../../../models/dashboard";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IDashboardRepository } from "../repository";
import { remove } from "./delete";
import { get } from "./get";
import { list } from "./list";
import { upsert } from "./upsert";

export class DashboardRepository implements IDashboardRepository {
  async get(ctx: DbReadCtx, spec: Dashboard.Spec, lock?: Lock) {
    return get(ctx.db, spec, lock);
  }
  async list(
    ctx: DbReadCtx,
    spec: Dashboard.Spec,
    cursor: Cursor<Dashboard.SortKey>,
  ): Promise<Page<Versioned<Dashboard>>> {
    return list(ctx.db, spec, cursor);
  }
  async upsert(ctx: DbWriteCtx, dashboard: Dashboard) {
    return upsert(ctx.db, dashboard);
  }
  async delete(ctx: DbWriteCtx, spec: Dashboard.Spec) {
    return remove(ctx.db, spec);
  }
}
