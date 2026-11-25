import { all } from "../../models/common";
import { usecase } from "../runner";

const many = { limit: 10000 };

/** Saved definitions with edit versions, for agents editing configuration. */
export const listConfiguration = (webhookConfigured: boolean) =>
  usecase({
    read: async (ctx) => ({
      dashboards: (await ctx.repos.dashboards.list(all(), many)).items,
      monitors: (await ctx.repos.monitors.list(all(), many)).items.map(
        ({ definition, version, state }) => ({ definition, version, state }),
      ),
      webhookConfigured,
    }),
  });
