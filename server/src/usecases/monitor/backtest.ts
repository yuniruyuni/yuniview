import { Monitor } from "../../models/monitor";
import { seriesAggregates, toPoint } from "../../models/panel";
import { cellLimit } from "../console/get-series";
import { usecase } from "../runner";

/** How a monitor, saved or not, would have judged the past days. */
export const backtest = (m: Monitor, end: Date) =>
  usecase({
    read: async (ctx) => {
      const panel = {
        ...m.panel,
        display: "chart" as const,
        minutes: Monitor.backtestDays * 1440,
      };
      const [aggregate] = seriesAggregates(
        panel,
        end,
        true,
        m.panel.minutes * 60,
      );
      return (await ctx.repos.cells.list(aggregate, { limit: cellLimit }))
        .items;
    },
    result: (cells) => Monitor.backtest(m, end, cells.map(toPoint)),
  });
