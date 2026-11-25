import {
  chartBucketSeconds,
  cpuPercent,
  defaultTotalSlots,
  type FilterField,
  type FilterOptions,
  isTimeField,
  type Panel,
  type Point,
  type ShelfAxis,
  type ShelfFields,
  shelfFields,
} from "../../../../shared/console";
import {
  Aggregate,
  type Cell,
  type Group,
  type Measure,
  type Output,
  type Relation,
} from "../aggregate";
import { and } from "../common";
import { DailySet } from "../daily-set";
import { Event } from "../event";
import { Field } from "../field";

export { dashboard, filter, filterField, monitor, panel } from "./schema";

const { group, output } = Aggregate;
const mib = 1048576;

/** Whether the panel counts application events (and routed requests). */
function countsEvents(p: Panel) {
  return p.measure === "events" || p.distinct?.dataset === "event";
}

/** The metric names the panel reads, the first being its main metric. */
function metricNames(p: Panel, pivot = p.pivot) {
  return [p.metric, ...(pivot?.metrics ?? [])];
}

/** Rows the panel measures, beyond its window and conditions. */
function kindOf(p: Panel, pivot = p.pivot): Event.Spec {
  if (p.distinct) return Event.Kind(p.distinct.dataset as Event.Kind);
  if (p.measure === "events") return Event.Kind("event");
  if (p.measure === "logs") return Event.Kind("log");
  if (p.measure === "metric")
    return and(
      Event.Kind("metric"),
      Event.Named(metricNames(p, pivot)),
      Event.HasValue(),
    );
  return and(Event.Kind("span"), Event.Entry());
}

function measureOf(p: Panel, pivot = p.pivot): Measure {
  if (p.distinct) return { type: "distinct", of: Field.attr(p.distinct.field) };
  switch (p.measure) {
    case "events":
      return { type: "aggregate", fn: "sum", of: "value" };
    case "latency":
      return { type: "percentile", fraction: 0.95, of: "value" };
    case "errors":
      return { type: "percent", where: Event.Failed() };
    case "metric": {
      const otherwise: Measure = {
        type: "aggregate",
        fn: p.aggregation,
        of: "value",
      };
      const cases = (pivot?.metricOptions ?? []).flatMap((o) =>
        o.aggregation && o.aggregation !== p.aggregation
          ? [
              [
                o.metric,
                { type: "aggregate", fn: o.aggregation, of: "value" },
              ] as const,
            ]
          : [],
      );
      return cases.length ? { type: "by_metric", cases, otherwise } : otherwise;
    }
    default:
      return { type: "count" };
  }
}

function shelfKey(
  fields: ShelfFields | undefined,
  field: (a: ShelfAxis) => Field,
) {
  return Field.key(shelfFields(fields).map(field));
}

function wantsUnit(p: Panel) {
  return p.display === "table" || Boolean(p.fieldUnits?.[`metric/${p.metric}`]);
}

/** Daily sets: distinct members per service and day, then summed. */
function dailySeries(p: Panel, end: Date, buckets: boolean): Aggregate {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "day"
      ? { type: "date", column: "day" }
      : key === "measure"
        ? Field.text("distinct")
        : Field.column("source");
  const perDay: Aggregate = {
    from: { type: "daily_sets", where: DailySet.scope(p, end) },
    by: [
      group("source", Field.column("source")),
      group("day", Field.column("day")),
    ],
    measures: [
      output("visitors", {
        type: "distinct",
        of: Field.column("digest"),
      }),
    ],
  };
  const by: Group[] = [
    group(
      "bucket",
      !pivot && buckets
        ? { type: "midnight", column: "day" }
        : Field.instant(end),
    ),
    group(
      "series",
      pivot
        ? shelfKey(pivot.row, field)
        : p.group === "all"
          ? Field.text("all")
          : Field.column("source"),
    ),
  ];
  if (pivot) by.push(group("column", shelfKey(pivot.column, field)));
  if (pivot && shelfFields(pivot.series).length)
    by.push(group("facet", shelfKey(pivot.series, field)));
  const visitors: Measure = { type: "aggregate", fn: "sum", of: "visitors" };
  return {
    from: Aggregate.of(perDay),
    by,
    measures: [
      output("value", visitors, "float8"),
      output("samples", visitors, "int"),
    ],
  };
}

/**
 * Gauge totals across slots. Agents sample independently, so each slot is
 * averaged within a minute before the slots are added, and only minutes
 * observed in every slot count.
 */
function slotTotalSeries(p: Panel, end: Date, buckets: boolean): Aggregate {
  const slots = p.totalSlots ?? defaultTotalSlots;
  const perSlot: Aggregate = {
    from: {
      type: "events",
      where: and(
        Event.matching(p, end),
        Event.Kind("metric"),
        Event.Named([p.metric]),
        Event.HasValue(),
        Event.FieldIn(Field.column("slot"), slots),
      ),
    },
    by: [
      group("minute", Field.bin(60)),
      ...["source", "workload", "slot"].map((c) => group(c, Field.column(c))),
    ],
    measures: [
      output("reading", { type: "aggregate", fn: "avg", of: "value" }),
      output("unit", { type: "aggregate", fn: "min", of: "unit" }),
    ],
  };
  const totals: Aggregate = {
    from: Aggregate.of(perSlot),
    by: ["minute", "source", "workload"].map((c) => group(c, Field.column(c))),
    measures: [
      output("total", { type: "aggregate", fn: "sum", of: "reading" }),
      output("unit", { type: "aggregate", fn: "min", of: "unit" }),
    ],
    having: { type: "rows", count: slots.length },
  };
  const measures: Output[] = [];
  if (wantsUnit(p))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  measures.push(
    output(
      "value",
      {
        type: "scaled",
        measure: { type: "aggregate", fn: p.aggregation, of: "total" },
        by: p.unit === "MiB" ? mib : 1,
      },
      "float8",
    ),
    output("samples", { type: "count" }, "int"),
  );
  return {
    from: Aggregate.of(totals),
    by: [
      group(
        "bucket",
        buckets
          ? Field.bin(Math.ceil(p.minutes / 40) * 60, "minute")
          : Field.instant(end),
      ),
      group("series", {
        type: "concat",
        parts: [Field.column("source"), Field.column("workload")],
        separator: "/",
      }),
    ],
    measures,
  };
}

/** The cells a panel shows at `end`, one per bucket, series, column and facet. */
export function seriesAggregate(
  p: Panel,
  end: Date,
  buckets: boolean,
): Aggregate {
  if (p.measure === "distinct" && p.distinct?.dataset === "daily")
    return dailySeries(p, end, buckets);
  if (p.group === "slot_total") return slotTotalSeries(p, end, buckets);

  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "measure"
      ? p.measure === "metric"
        ? Field.column("name")
        : Field.text(p.measure)
      : Field.ofTelemetry(key);
  const by: Group[] = [
    group(
      "bucket",
      buckets && !pivot
        ? Field.bin(chartBucketSeconds(p.minutes))
        : Field.instant(end),
    ),
    group(
      "series",
      pivot
        ? shelfKey(pivot.row, field)
        : p.group === "all"
          ? Field.text("all")
          : field(p.group as ShelfAxis),
    ),
  ];
  if (pivot) by.push(group("column", shelfKey(pivot.column, field)));
  if (pivot && shelfFields(pivot.series).length)
    by.push(group("facet", shelfKey(pivot.series, field)));

  const measure = measureOf(p, pivot);
  const measures: Output[] = [];
  if (p.measure === "metric" && (pivot || wantsUnit(p)))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  measures.push(
    output(
      "value",
      { type: "scaled", measure, by: p.unit === "MiB" ? mib : 1 },
      "float8",
    ),
    countsEvents(p)
      ? output("samples", { type: "aggregate", fn: "sum", of: "value" })
      : output("samples", { type: "count" }, "int"),
  );

  const where = and(Event.matching(p, end), kindOf(p, pivot));
  const from: Relation = countsEvents(p)
    ? { type: "analysis_events", where }
    : p.measure === "metric" && metricNames(p, pivot).includes(cpuPercent)
      ? { type: "cpu_readings", window: Event.matching(p, end), where }
      : { type: "events", where };
  return { from, by, measures, having: { type: "present", measure } };
}

/** Compound keys arrive as text arrays; points carry them as JSON and paths. */
export function toPoint(cell: Cell): Point {
  const { series, column, facet, ...rest } = cell as Record<string, unknown> &
    Pick<Point, "bucket" | "value" | "samples">;
  const point = { ...rest } as unknown as Point;
  if (Array.isArray(facet)) {
    point.facet = JSON.stringify(facet);
    point.facetPath = facet;
  } else point.facet = facet as string | undefined;
  if (Array.isArray(series)) {
    point.series = JSON.stringify(series);
    point.rowPath = series;
  } else point.series = series as string;
  if (Array.isArray(column)) {
    point.column = JSON.stringify(column);
    point.columnPath = column;
  } else if (column !== undefined) point.column = column as string;
  return point;
}

/** Choices offered for a worksheet filter, ignoring the field's own condition. */
export function filterChoices(
  panel: Panel,
  name: Exclude<FilterField, "log">,
  end: Date,
  search: string,
):
  | { values: Aggregate; numeric: Aggregate; range?: undefined }
  | { range: Aggregate; values?: undefined; numeric?: undefined }
  | null {
  const p = {
    ...panel,
    conditions: panel.conditions?.filter((c) => c.field !== name),
  };
  const daily = p.distinct?.dataset === "daily";
  if (daily && name !== "source" && name !== "day") return null;
  const field = daily
    ? Field.ofDailySet(name as "day" | "source")
    : Field.ofTelemetry(name);
  const scope = (extra?: "search"): Relation => {
    if (daily)
      return {
        type: "daily_sets",
        where: extra
          ? and(DailySet.scope(p, end), DailySet.FieldMatches(field, search))
          : DailySet.scope(p, end),
      };
    const names = metricNames(p).map((m) =>
      m === cpuPercent ? "cpu.usage" : m,
    );
    const kind: Event.Spec = countsEvents(p)
      ? Event.Kind("event")
      : p.measure === "metric"
        ? and(Event.Kind("metric"), Event.Named(names))
        : p.measure === "logs" || p.distinct?.dataset === "log"
          ? Event.Kind("log")
          : p.distinct?.dataset === "span"
            ? Event.Kind("span")
            : and(Event.Kind("span"), Event.Entry());
    const where: Event.Spec = and(
      Event.matching(p, end),
      kind,
      ...(extra ? [Event.FieldMatches(field, search)] : []),
    );
    return countsEvents(p)
      ? { type: "analysis_events", where }
      : { type: "events", where };
  };
  const bounds = [
    output("min", { type: "bound", fn: "min", of: field }, "float8"),
    output("max", { type: "bound", fn: "max", of: field }, "float8"),
  ];
  if (name === "day" || isTimeField(name))
    return { range: { from: scope(), by: [], measures: bounds } };
  return {
    values: {
      from: scope("search"),
      by: [group("value", Field.observed(field))],
      measures: [],
    },
    numeric: {
      from: scope(),
      by: [],
      measures: [output("numeric", { type: "numeric", of: field }), ...bounds],
    },
  };
}

export const filterValueLimit = 60;
export function toFilterOptions(
  values: Cell[],
  summary: Cell | undefined,
): FilterOptions {
  return {
    values: values.slice(0, filterValueLimit).map((c) => String(c.value)),
    more: values.length > filterValueLimit,
    numeric: Boolean(summary?.numeric),
    min: (summary?.min as number | null) ?? null,
    max: (summary?.max as number | null) ?? null,
  };
}
export const noFilterOptions: FilterOptions = {
  values: [],
  more: false,
  numeric: false,
  min: null,
  max: null,
};

/** Attribute keys observed in recent rows of the worksheet's data. */
export function attributeKeys(input: {
  source: string;
  kind: Event.Kind;
  metric: string;
  end: Date;
  minutes: number;
}): Aggregate {
  const specs: Event.Spec[] = [
    Event.Window(
      new Date(input.end.getTime() - input.minutes * 60000),
      input.end,
    ),
    Event.Kind(input.kind),
  ];
  if (input.source)
    specs.push(Event.FieldIn(Field.column("source"), [input.source]));
  if (input.kind === "metric") specs.push(Event.Named([input.metric]));
  return {
    from: {
      type: "attribute_keys",
      from: input.kind === "event" ? "analysis_events" : "events",
      where: and(...specs),
      sample: 512,
    },
    by: [group("key", Field.column("key"))],
    measures: [],
  };
}
