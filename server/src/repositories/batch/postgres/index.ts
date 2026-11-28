import type { Batch } from "../../../models/batch";
import type { Cursor, Page } from "../../../models/common";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IBatchRepository } from "../repository";
import { count } from "./count";
import { remove } from "./delete";
import { dropPayloads } from "./drop-payloads";
import { list } from "./list";
import { upsert } from "./upsert";

export class BatchRepository implements IBatchRepository {
  async list(
    ctx: DbReadCtx,
    spec: Batch.Spec,
    cursor: Cursor<Batch.SortKey>,
  ): Promise<Page<Batch>> {
    return list(ctx.db, spec, cursor);
  }
  async count(ctx: DbReadCtx, spec: Batch.Spec): Promise<number> {
    return count(ctx.db, spec);
  }
  async upsert(ctx: DbWriteCtx, batch: Batch): Promise<void> {
    return upsert(ctx.db, batch);
  }
  async delete(ctx: DbWriteCtx, spec: Batch.Spec): Promise<number> {
    return remove(ctx.db, spec);
  }
  async dropPayloads(ctx: DbWriteCtx, spec: Batch.Spec): Promise<number> {
    return dropPayloads(ctx.db, spec);
  }
}
