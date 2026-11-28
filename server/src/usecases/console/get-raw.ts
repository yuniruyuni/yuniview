import { Batch } from "../../models/batch";
import { fail } from "../../models/common";
import { usecase } from "../runner";

/**
 * The part of the delivered payload one row was decoded from, while the
 * payload is kept; after that, only when it was received.
 */
export const getRaw = (key: Batch.Key, ordinal: number) =>
  usecase({
    read: async (ctx) => {
      const [batch] = (
        await ctx.repos.batches.list(Batch.ByKeys(key), { limit: 1 })
      ).items;
      if (!batch) return fail("NOT_FOUND", "no such batch");
      const raw = Batch.raw(batch, ordinal);
      if (!raw) return fail("NOT_FOUND", "no such row");
      return { ...raw, receivedAt: batch.receivedAt.toISOString() };
    },
  });
