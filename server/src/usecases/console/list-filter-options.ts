import type { FilterField } from "../../../../shared/console";
import {
  filterChoices,
  filterValueLimit,
  noFilterOptions,
  type Scope,
  toFilterOptions,
} from "../../models/panel";
import { usecase } from "../runner";

export const listFilterOptions = (
  scope: Scope,
  field: Exclude<FilterField, "text">,
  end: Date,
  search: string,
) =>
  usecase({
    read: async (ctx) => {
      const choices = filterChoices(scope, field, end, search);
      if (!choices) return noFilterOptions;
      if (choices.range) {
        const [range] = (
          await ctx.repos.cells.list(choices.range, { limit: 1 })
        ).items;
        return {
          values: [],
          more: false,
          numeric: true,
          min: (range?.min as number | null) ?? null,
          max: (range?.max as number | null) ?? null,
        };
      }
      const values = await ctx.repos.cells.list(choices.values, {
        limit: filterValueLimit + 1,
      });
      const [summary] = (
        await ctx.repos.cells.list(choices.numeric, { limit: 1 })
      ).items;
      return toFilterOptions(values.items, summary);
    },
  });
