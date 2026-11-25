import { fail } from "../../models/common";
import { Monitor } from "../../models/monitor";
import { usecase } from "../runner";
import { conflictMessage } from "./save-dashboard";

export const noWebhookMessage = "通知先が設定されていません";

/**
 * Saves a complete monitor. A changed definition is evaluated again at the
 * next tick; see {@link saveDashboard} for expected versions.
 */
export const saveMonitor = (
  definition: Monitor,
  notificationsAvailable: boolean,
  expectedVersion?: string | null,
) =>
  usecase({
    pre: () =>
      definition.notify && !notificationsAvailable
        ? fail("INVALID_INPUT", noWebhookMessage)
        : {},
    read: async (ctx) => ({
      stored: await ctx.repos.monitors.get(
        Monitor.ById(definition.id),
        "update",
      ),
    }),
    process: (_ctx, { stored }) => {
      if (
        expectedVersion !== undefined &&
        (stored?.version ?? null) !== expectedVersion
      )
        return fail("CONFLICT", conflictMessage);
      return Monitor.revise(stored, definition);
    },
    write: async (ctx, record) => {
      await ctx.repos.monitors.upsert(record);
      const saved = await ctx.repos.monitors.get(Monitor.ById(definition.id));
      return saved && { definition: saved.definition, version: saved.version };
    },
  });
