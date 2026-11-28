import { Batch } from "../../models/batch";
import { DailySet } from "../../models/daily-set";
import { usecase } from "../runner";

const expiryStep = 1000;

/**
 * Removes daily-set members past their window and, when `retentionDays` is
 * positive, a bounded step of batches received before the retention period.
 * When `payloadDays` is positive, drops a bounded step of the payloads of
 * indexed batches received before it; the batches and their rows stay.
 */
export const expire = (retentionDays: number, payloadDays = 0) =>
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
      const payloads = payloadDays
        ? await ctx.repos.batches.dropPayloads(
            Batch.PayloadBefore(
              new Date(ctx.now.getTime() - payloadDays * 86400000),
              expiryStep,
            ),
          )
        : 0;
      return { members, batches, payloads };
    },
  });
