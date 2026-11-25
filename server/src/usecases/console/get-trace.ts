import { Event } from "../../models/event";
import { usecase } from "../runner";

export const traceLimit = 2000;

/** Spans and logs of one trace across services, in time order. */
export const getTrace = (trace: string) =>
  usecase({
    read: async (ctx) =>
      ctx.repos.events.list(Event.Trace(trace), {
        limit: traceLimit,
        sort: { keys: Event.order, order: "asc" },
      }),
  });
