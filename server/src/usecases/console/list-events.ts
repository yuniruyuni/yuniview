import type { DataKind, Filter } from "../../../../shared/console";
import { and } from "../../models/common";
import { Event } from "../../models/event";
import { kindOf } from "../../models/panel";
import { usecase } from "../runner";

export const eventPage = 100;

/** Rows of a query, newest first, continuing after a cursor. */
export const listEvents = (
  query: Filter & { data: Exclude<DataKind, "daily"> },
  end: Date,
  after?: Record<Event.SortKey, string>,
) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.events.list(
        and(Event.matching(query, end), kindOf(query.data)),
        { limit: eventPage, after },
      ),
  });
