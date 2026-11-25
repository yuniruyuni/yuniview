import type { Event } from "../../models/event";
import { attributeKeys } from "../../models/panel";
import { usecase } from "../runner";

export const listAttributes = (input: {
  source: string;
  kind: Event.Kind;
  metric: string;
  end: Date;
  minutes: number;
}) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.cells.list(attributeKeys(input), { limit: 128 }),
    result: (page) => page.items.map((c) => c.key as string),
  });
