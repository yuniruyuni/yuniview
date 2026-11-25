import type { Cursor, Page } from "../../models/common";
import type { Source } from "../../models/source";
import type { DbReadCtx } from "../common/capability";

export interface ISourceRepository {
  list(
    ctx: DbReadCtx,
    spec: Source.Spec,
    cursor: Cursor<Source.SortKey>,
  ): Promise<Page<Source>>;
}
