import type { FilterField } from "../../../../shared/console";
import {
  type Scope,
  topValueLimit,
  topValues,
  toTopValue,
} from "../../models/panel";
import { usecase } from "../runner";

/** The values of a field most rows of a query have, with their counts. */
export const listTopValues = (
  scope: Scope,
  field: Exclude<FilterField, "text">,
  end: Date,
) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.cells.list(topValues(scope, field, end), {
        limit: topValueLimit,
        sort: { keys: ["count"], order: "desc" },
      }),
    result: (page) => page.items.map(toTopValue),
  });
