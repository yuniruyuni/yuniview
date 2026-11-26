import {
  Monitor,
  MonitorEvent,
  type MonitorRecord,
} from "../../models/monitor";
import { toPoint } from "../../models/panel";
import { readSeries } from "../console/get-series";
import { usecase } from "../runner";

const evaluationStep = 1000;

/**
 * Evaluates monitors not yet evaluated for the latest complete minute and
 * records state changes. Monitors another worker holds are left to it.
 */
export const evaluateMonitors = () =>
  usecase({
    read: async (ctx) => {
      const end = Monitor.windowEnd(ctx.now);
      const due = await ctx.repos.monitors.list(Monitor.Due(end), {
        limit: evaluationStep,
        sort: { keys: ["id"], order: "asc" },
        lock: "skip_locked",
      });
      const observed = [];
      for (const record of due.items) {
        const cells = await readSeries(
          ctx,
          record.definition.panel,
          end,
          false,
        );
        observed.push({ record, points: cells.map(toPoint) });
      }
      return { end, observed };
    },
    process: (ctx, { end, observed }) =>
      observed.map(({ record, points }) => {
        const { state, value } = Monitor.verdict(record.definition, points);
        const next: MonitorRecord = { ...record, state, value, evaluated: end };
        const event =
          state === record.state
            ? null
            : MonitorEvent.transition(
                record.definition,
                state,
                end,
                value,
                ctx.now,
              );
        return { next, event };
      }),
    write: async (ctx, changes) => {
      for (const { next, event } of changes) {
        await ctx.repos.monitors.upsert(next);
        if (event) await ctx.repos.monitorEvents.upsert(event);
      }
      return changes.length;
    },
  });
