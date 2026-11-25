import type { Transition } from "../../../../shared/console";
import { all } from "../../models/common";
import { usecase } from "../runner";

const many = { limit: 10000 };
export const historyLimit = 100;

/** Saved dashboards and monitors with recent monitor state changes. */
export const getLibrary = (notificationsAvailable: boolean) =>
  usecase({
    read: async (ctx) => ({
      dashboards: (await ctx.repos.dashboards.list(all(), many)).items,
      monitors: (await ctx.repos.monitors.list(all(), many)).items,
      history: (
        await ctx.repos.monitorEvents.list(all(), { limit: historyLimit })
      ).items,
    }),
    result: (r) => ({
      dashboards: r.dashboards.map((d) => d.definition),
      versionedDashboards: r.dashboards,
      monitors: r.monitors,
      history: r.history.map(
        ({ id, title, state, at, value, delivery }): Transition => ({
          id,
          title,
          state,
          at,
          value,
          delivery,
        }),
      ),
      webhook: notificationsAvailable,
    }),
  });
