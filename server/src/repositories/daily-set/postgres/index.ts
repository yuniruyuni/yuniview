import type { DailySet } from "../../../models/daily-set";
import type { DbWriteCtx } from "../../common/capability";
import type { IDailySetRepository } from "../repository";
import { remove } from "./delete";
import { upsert } from "./upsert";

export class DailySetRepository implements IDailySetRepository {
  async upsert(ctx: DbWriteCtx, member: DailySet): Promise<void> {
    return upsert(ctx.db, member);
  }
  async delete(ctx: DbWriteCtx, spec: DailySet.Spec): Promise<number> {
    return remove(ctx.db, spec);
  }
}
