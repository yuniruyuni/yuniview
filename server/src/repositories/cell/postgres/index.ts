import type { Cell } from "../../../models/aggregate";
import type { Cursor, Page } from "../../../models/common";
import type { DbReadCtx } from "../../common/capability";
import type { ICellRepository } from "../repository";
import { list } from "./list";

export class CellRepository implements ICellRepository {
  async list(
    ctx: DbReadCtx,
    spec: Cell.Spec,
    cursor: Cursor<Cell.SortKey>,
  ): Promise<Page<Cell>> {
    return list(ctx.db, spec, cursor);
  }
}
