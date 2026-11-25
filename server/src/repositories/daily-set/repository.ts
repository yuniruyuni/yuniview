import type { DailySet } from "../../models/daily-set";
import type { DbWriteCtx } from "../common/capability";

export interface IDailySetRepository {
  upsert(ctx: DbWriteCtx, member: DailySet): Promise<void>;
  delete(ctx: DbWriteCtx, spec: DailySet.Spec): Promise<number>;
}
