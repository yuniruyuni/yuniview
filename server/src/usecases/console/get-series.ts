import type { Panel } from "../../../../shared/console";
import type { Cell } from "../../models/aggregate";
import { seriesAggregates, toPoint } from "../../models/panel";
import type { ReadContext } from "../context";
import { usecase } from "../runner";

/** More cells than any chart or table can show. */
export const cellLimit = 100000;

/** The cells of every value of a panel, within {@link cellLimit} in total. */
export async function readSeries(
  ctx: ReadContext,
  panel: Panel,
  end: Date,
  buckets: boolean,
): Promise<Cell[]> {
  const cells: Cell[] = [];
  for (const aggregate of seriesAggregates(panel, end, buckets)) {
    const limit = cellLimit - cells.length;
    if (limit <= 0) break;
    const page = await ctx.repos.cells.list(aggregate, { limit });
    cells.push(...page.items);
  }
  return cells;
}

export const getSeries = (panel: Panel, end: Date, buckets: boolean) =>
  usecase({
    read: (ctx) => readSeries(ctx, panel, end, buckets),
    result: (cells) => cells.map(toPoint),
  });
