import { isFail } from "../../models/common";
import { MonitorEvent } from "../../models/monitor";
import { usecase } from "../runner";

/**
 * Sends due monitor notifications. Each is claimed for a minute first, so a
 * failed or interrupted delivery is retried and others never send it twice
 * at once. Notifications of one monitor are sent in order.
 */
export const deliverNotifications = () =>
  usecase({
    read: async (ctx) =>
      (
        await ctx.repos.monitorEvents.list(MonitorEvent.Deliverable(ctx.now), {
          limit: MonitorEvent.batchSize,
          sort: { keys: ["createdAt", "id"], order: "asc" },
          lock: "skip_locked",
        })
      ).items,
    process: (ctx, due) =>
      due.map((e) => ({
        ...e,
        retryAt: new Date(ctx.now.getTime() + MonitorEvent.retryDelayMs),
      })),
    write: async (ctx, claimed) => {
      for (const e of claimed) await ctx.repos.monitorEvents.upsert(e);
      return claimed;
    },
    post: async (ctx, claimed) => {
      const sent: MonitorEvent[] = [];
      for (const e of claimed) {
        const result = await ctx.repos.webhook.send(
          e.id,
          MonitorEvent.notification(e),
        );
        if (isFail(result))
          ctx.logger.error("monitor webhook", e.id, result.message);
        else sent.push({ ...e, delivery: "sent" });
      }
      return sent;
    },
    finish: async (ctx, sent) => {
      for (const e of sent) await ctx.repos.monitorEvents.upsert(e);
      return sent.length;
    },
  });
