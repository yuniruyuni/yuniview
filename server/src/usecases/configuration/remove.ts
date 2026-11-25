import { Dashboard } from "../../models/dashboard";
import { Monitor } from "../../models/monitor";
import { usecase } from "../runner";

export const remove = (kind: "dashboard" | "monitor", id: string) =>
  usecase({
    write: async (ctx) =>
      (kind === "dashboard"
        ? await ctx.repos.dashboards.delete(Dashboard.ById(id))
        : await ctx.repos.monitors.delete(Monitor.ById(id))) > 0,
  });
