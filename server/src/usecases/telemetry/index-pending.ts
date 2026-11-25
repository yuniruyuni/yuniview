import { Batch } from "../../models/batch";
import { usecase } from "../runner";

export const indexStep = 8;

/**
 * Indexes rows of batches stored before indexing existed. Other workers skip
 * the batches this one holds. Returns how many batches were indexed.
 */
export const indexPending = () =>
  usecase({
    read: async (ctx) =>
      (
        await ctx.repos.batches.list(Batch.Pending(), {
          limit: indexStep,
          lock: "skip_locked",
        })
      ).items,
    process: (_ctx, batches) => batches.map(Batch.index),
    write: async (ctx, batches) => {
      for (const batch of batches) await ctx.repos.batches.upsert(batch);
      return batches.length;
    },
  });
