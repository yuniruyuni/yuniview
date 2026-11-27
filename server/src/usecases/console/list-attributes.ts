import type { DataKind, Filter } from "../../../../shared/console";
import { attributeKeys } from "../../models/panel";
import { usecase } from "../runner";

export const listAttributes = (
  input: Filter & { data: DataKind; metric?: string; end: Date },
) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.cells.list(attributeKeys(input), { limit: 128 }),
    result: (page) => page.items.map((c) => c.key as string),
  });
