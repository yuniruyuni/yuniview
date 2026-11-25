import type { Cursor, Page } from "../../../models/common";
import type { Source } from "../../../models/source";
import type { DbReadCtx } from "../../common/capability";
import type { ISourceRepository } from "../repository";
import { list } from "./list";

export class SourceRepository implements ISourceRepository {
  async list(
    ctx: DbReadCtx,
    spec: Source.Spec,
    cursor: Cursor<Source.SortKey>,
  ): Promise<Page<Source>> {
    return list(ctx.db, spec, cursor);
  }
}
