import type { Cell } from "../../models/aggregate";
import type { Cursor, Page } from "../../models/common";
import type { DbReadCtx } from "../common/capability";

/** Measured parts of stored rows. The aggregate is the spec of its cells. */
export interface ICellRepository {
  list(
    ctx: DbReadCtx,
    spec: Cell.Spec,
    cursor: Cursor<Cell.SortKey>,
  ): Promise<Page<Cell>>;
}
