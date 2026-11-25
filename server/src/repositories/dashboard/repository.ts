import type { Cursor, Lock, Page } from "../../models/common";
import type { Dashboard, Versioned } from "../../models/dashboard";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IDashboardRepository {
  get(
    ctx: DbReadCtx,
    spec: Dashboard.Spec,
    lock?: Lock,
  ): Promise<Versioned<Dashboard> | null>;
  list(
    ctx: DbReadCtx,
    spec: Dashboard.Spec,
    cursor: Cursor<Dashboard.SortKey>,
  ): Promise<Page<Versioned<Dashboard>>>;
  upsert(ctx: DbWriteCtx, dashboard: Dashboard): Promise<void>;
  delete(ctx: DbWriteCtx, spec: Dashboard.Spec): Promise<number>;
}
