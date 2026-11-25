import { fail } from "../../models/common";
import { Dashboard } from "../../models/dashboard";
import { usecase } from "../runner";

export const conflictMessage =
  "別の編集が保存されました。最新の設定を開き直してください。";

/**
 * Saves a complete dashboard. With an expected version (null for a new ID)
 * the save only succeeds against that stored version.
 */
export const saveDashboard = (
  definition: Dashboard,
  expectedVersion?: string | null,
) =>
  usecase({
    read: async (ctx) => ({
      stored: await ctx.repos.dashboards.get(
        Dashboard.ById(definition.id),
        "update",
      ),
    }),
    process: (_ctx, { stored }) => {
      if (
        expectedVersion !== undefined &&
        (stored?.version ?? null) !== expectedVersion
      )
        return fail("CONFLICT", conflictMessage);
      return definition;
    },
    write: async (ctx, d) => {
      await ctx.repos.dashboards.upsert(d);
      return ctx.repos.dashboards.get(Dashboard.ById(d.id));
    },
  });
