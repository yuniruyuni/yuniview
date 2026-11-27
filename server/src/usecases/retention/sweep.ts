import { Batch } from "../../models/batch";
import { and } from "../../models/common";
import { RetentionRule, type SweepStep } from "../../models/retention";
import { usecase } from "../runner";

/** Batches checked per statement for rows left. */
const batchStep = 500;

/**
 * What the sweep would delete next. Reading this is cheap and runs every
 * tick, so the worker can skip {@link sweep}, and its records, when there is
 * nothing to do.
 */
export const planSweep = () =>
  usecase({
    read: async (ctx) => {
      const records = await ctx.repos.retentionRules.list();
      const earliest = RetentionRule.needsEarliest(records)
        ? await ctx.repos.events.earliest()
        : null;
      return RetentionRule.plan(records, ctx.now, earliest);
    },
  });

/**
 * Deletes the rows each step's rule decides, then the batches left without
 * rows, and records how far each rule has been swept. Returns the rows
 * deleted, or 0 when another worker is sweeping.
 */
export const sweep = (steps: readonly SweepStep[]) =>
  usecase({
    write: async (ctx) => {
      if (!(await ctx.repos.retentionRules.takeSweep())) return 0;
      let deleted = 0;
      for (const step of steps) {
        const gone = await ctx.repos.events.sweep(step, step.from, step.to);
        deleted += gone.deleted;
        for (let i = 0; i < gone.batches.length; i += batchStep)
          await ctx.repos.batches.delete(
            and(
              Batch.ByKeys(...gone.batches.slice(i, i + batchStep)),
              Batch.Emptied(),
            ),
          );
        await ctx.repos.retentionRules.advance(step.id, step.previous, step.to);
      }
      return deleted;
    },
  });
