import type { Filter, Overview, RouteRow } from "../../../../shared/console";
import { Aggregate, type Cell } from "../aggregate";
import { and } from "../common";
import { Event } from "../event";
import { Field } from "../field";
import type { Source } from "../source";

const { group, output } = Aggregate;
const entry = Event.Entry();

/** Server-span totals per service within the filter. */
export function serviceStats(f: Filter, end: Date): Aggregate {
  return {
    from: {
      type: "events",
      where: and(Event.matching(f, end), Event.Kind("span"), entry),
    },
    by: [group("source", Field.column("source"))],
    measures: [
      output("requests", { type: "count" }, "int"),
      output("errors", { type: "count", where: Event.Failed() }, "int"),
      output("latency", { type: "percentile", fraction: 0.95, of: "value" }),
    ],
  };
}

/** Metric names and daily sets that have been received. */
export const choices = {
  metrics: {
    from: { type: "metric_names" },
    by: [group("item", Field.column("name"))],
    measures: [],
  },
  dailyFields: {
    from: { type: "daily_sets", where: and() },
    by: [group("item", Field.column("field"))],
    measures: [],
  },
} satisfies Record<string, Aggregate>;

export function overview(
  sources: Source[],
  stats: Cell[],
  found: Record<keyof typeof choices, Cell[]>,
): Overview {
  const bySource = new Map(stats.map((s) => [s.source as string, s]));
  const items = (cells: Cell[]) => cells.map((c) => c.item as string);
  return {
    services: sources.map((s) => {
      const st = bySource.get(s.id);
      return {
        source: s.id,
        last: s.lastReceived as unknown as string | null,
        requests: (st?.requests as number) ?? 0,
        errors: (st?.errors as number) ?? 0,
        latency: (st?.latency as number | null) ?? null,
      };
    }),
    metrics: items(found.metrics),
    dailyFields: items(found.dailyFields),
  };
}

export const routeLimit = 200;
/** Server spans per service and route, with the slowest trace of each. */
export function routes(f: Filter, end: Date): Aggregate {
  return {
    from: {
      type: "events",
      where: and(Event.matching(f, end), Event.Kind("span"), entry),
    },
    by: [
      group("source", Field.column("source")),
      group("name", Field.column("name")),
    ],
    measures: [
      output("requests", { type: "count" }, "int"),
      output("errors", { type: "count", where: Event.Failed() }, "int"),
      output("p95", { type: "percentile", fraction: 0.95, of: "value" }),
      output("trace", { type: "slowest_trace" }),
    ],
  };
}
export function toRoute(c: Cell): RouteRow {
  return c as unknown as RouteRow;
}
