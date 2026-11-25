import type { FieldCondition, Filter } from "../../../../shared/console";
import { and } from "../../models/common";
import { Event } from "../../models/event";
import { usecase } from "../runner";

export const eventPage = 100;

export const listEvents = (
  query: Filter & {
    kind: Event.Kind;
    conditions?: FieldCondition[];
    logContains?: string;
  },
  end: Date,
  after?: Record<Event.SortKey, string>,
) =>
  usecase({
    read: async (ctx) => {
      // The log stream searches only the body; worksheet conditions do not apply.
      const filter =
        query.kind === "log" && query.logContains
          ? {
              ...query,
              conditions: [
                { field: "log" as const, contains: query.logContains },
              ],
            }
          : query;
      const repo =
        query.kind === "event" ? ctx.repos.occurrences : ctx.repos.events;
      return repo.list(
        and(Event.matching(filter, end), Event.Kind(query.kind)),
        {
          limit: eventPage,
          after,
        },
      );
    },
  });
