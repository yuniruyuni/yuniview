import { Batch } from "../../models/batch";
import { DailySet } from "../../models/daily-set";
import { usecase } from "../runner";

const expiryStep = 1000;

/**
 * Removes daily-set members past their window and, when `retentionDays` is
 * positive, a bounded step of batches received before the retention period.
 */
export const expire = (retentionDays: number) =>
  usecase({
    write: async (ctx) => {
      const members = await ctx.repos.dailySets.delete(
        DailySet.expired(ctx.now),
      );
      const batches = retentionDays
        ? await ctx.repos.batches.delete(
            Batch.OldestBefore(
              new Date(ctx.now.getTime() - retentionDays * 86400000),
              expiryStep,
            ),
          )
        : 0;
      return { members, batches };
    },
  });
