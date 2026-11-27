import { all } from "../../models/common";
import { FieldNote } from "../../models/dictionary";
import { usecase } from "../runner";

/** Every field anyone described, with the core fields. */
export const listFields = () =>
  usecase({
    read: async (ctx) =>
      (await ctx.repos.fieldNotes.list(all(), { limit: 10000 })).items,
    result: (notes) => FieldNote.dictionary(notes),
  });
