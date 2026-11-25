import type { Filter } from "../../../../shared/console";
import { routeLimit, routes, toRoute } from "../../models/overview";
import { usecase } from "../runner";

export const listRoutes = (f: Filter, end: Date) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.cells.list(routes(f, end), {
        limit: routeLimit,
        sort: { keys: ["requests"], order: "desc" },
      }),
    result: (page) => page.items.map(toRoute),
  });
