import type { Panel } from "../../../../shared/console";
import { seriesAggregate, toPoint } from "../../models/panel";
import { usecase } from "../runner";

/** More cells than any chart or table can show. */
export const cellLimit = 100000;

export const getSeries = (panel: Panel, end: Date, buckets: boolean) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.cells.list(seriesAggregate(panel, end, buckets), {
        limit: cellLimit,
      }),
    result: (page) => page.items.map(toPoint),
  });
