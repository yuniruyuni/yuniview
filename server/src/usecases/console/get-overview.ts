import type { Filter } from "../../../../shared/console";
import type { Cell } from "../../models/aggregate";
import { all } from "../../models/common";
import { choices, overview, serviceStats } from "../../models/overview";
import { usecase } from "../runner";

const many = { limit: 10000 };

export const getOverview = (f: Filter, end: Date) =>
  usecase({
    read: async (ctx) => {
      const sources = await ctx.repos.sources.list(all(), many);
      const stats = await ctx.repos.cells.list(serviceStats(f, end), many);
      const found = {} as Record<keyof typeof choices, Cell[]>;
      for (const key of Object.keys(choices) as (keyof typeof choices)[])
        found[key] = (await ctx.repos.cells.list(choices[key], many)).items;
      return overview(sources.items, stats.items, found);
    },
  });
