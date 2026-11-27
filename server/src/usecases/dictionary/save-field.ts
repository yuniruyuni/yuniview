import type { FieldMeta } from "../../../../shared/console";
import { FieldNote } from "../../models/dictionary";
import { usecase } from "../runner";

/**
 * Records what a person says about a field. A part set to null is removed,
 * so what the sender said shows again.
 */
export const saveField = (
  key: string,
  patch: { [K in keyof FieldMeta]?: FieldMeta[K] | null },
) =>
  usecase({
    read: async (ctx) =>
      (
        await ctx.repos.fieldNotes.list(FieldNote.ByKeys([key]), {
          limit: 1,
          lock: "update",
        })
      ).items[0],
    process: (_ctx, stored) => FieldNote.edited(stored, key, patch),
    write: async (ctx, change) => {
      await ctx.repos.fieldNotes.upsert(change);
      return change;
    },
    finish: async (ctx) =>
      (await ctx.repos.fieldNotes.list(FieldNote.ByKeys([key]), { limit: 1 }))
        .items,
    result: (notes) => FieldNote.dictionary(notes).find((f) => f.key === key),
  });
