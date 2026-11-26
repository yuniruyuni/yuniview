import {
  chartBucketSeconds,
  cpuPercent,
  type DataKind,
  defaultTotalSlots,
  type FilterField,
  type FilterOptions,
  isTimeField,
  metricOf,
  type Panel,
  type Point,
  type ShelfAxis,
  type ShelfFields,
  setOf,
  shelfFields,
  type Value,
  valueKey,
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

export {
  conditions,
  dashboard,
  filter,
  filterField,
  monitor,
  panel,
} from "./schema";

const { group, output } = Aggregate;
const mib = 1048576;

/** Rows of a kind of data, beyond the window and conditions. */
function kindOf(data: DataKind): Event.Spec {
  switch (data) {
    case "request":
      return and(Event.Kind("span"), Event.Entry());
    case "span":
      return Event.Kind("span");
    case "log":
      return Event.Kind("log");
    case "event":
      return Event.Kind("event");
    default:
      return Event.Kind("metric");
  }
}

/** Rows a value reads: its data, narrowed to its metric. */
function rowsOf(p: Panel, v: Value): Event.Spec {
  const metric = metricOf(v.of[0]);
  if (metric === undefined) return kindOf(p.data);
  return and(Event.Kind("metric"), Event.Named([metric]), Event.HasValue());
}

const fractions = { p50: 0.5, p95: 0.95, p99: 0.99 } as const;
function measureOf(v: Value): Measure {
  switch (v.agg) {
    case "count":
      return { type: "count" };
    case "ratio":
      return { type: "percent", where: Event.Failed() };
    case "distinct":
      return {
        type: "distinct",
        of: Field.key(
          v.of.map((f) => Field.ofTelemetry(f as Exclude<FilterField, "log">)),
        ),
      };
    case "p50":
    case "p95":
    case "p99":
      return { type: "percentile", fraction: fractions[v.agg], of: "value" };
    case "daily":
      throw Error("daily sets are measured per day");
    default:
      return { type: "aggregate", fn: v.agg, of: "value" };
  }
}

function shelfKey(
  fields: ShelfFields | undefined,
  field: (a: ShelfAxis) => Field,
) {
  return Field.key(shelfFields(fields).map(field));
}

function unitKey(v: Value) {
  const metric = metricOf(v.of[0]);
  return metric === undefined ? valueKey(v) : "metric/" + metric;
}

function wantsUnit(p: Panel, v: Value) {
  return p.display === "table" || Boolean(p.fieldUnits?.[unitKey(v)]);
}

/** Daily sets: distinct members per service and day, then summed. */
function dailySeries(
  p: Panel,
  v: Value,
  end: Date,
  buckets: boolean,
): Aggregate {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "day"
      ? { type: "date", column: "day" }
      : key === "measure"
        ? Field.text(valueKey(v))
        : Field.column("source");
  const perDay: Aggregate = {
    from: {
      type: "daily_sets",
      where: DailySet.scope(p, setOf(v.of[0]) ?? "", end),
    },
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
function slotTotalSeries(
  p: Panel,
  v: Value,
  end: Date,
  buckets: boolean,
): Aggregate {
  const slots = p.totalSlots ?? defaultTotalSlots;
  const perSlot: Aggregate = {
    from: {
      type: "events",
      where: and(
        Event.matching(p, end),
        rowsOf(p, v),
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
  if (wantsUnit(p, v))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  const fn = v.agg === "min" || v.agg === "max" ? v.agg : "avg";
  measures.push(
    output(
      "value",
      {
        type: "scaled",
        measure: { type: "aggregate", fn, of: "total" },
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

/** The cells of one value, one per bucket, series, column and facet. */
function valueSeries(
  p: Panel,
  v: Value,
  end: Date,
  buckets: boolean,
): Aggregate {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "measure" ? Field.text(valueKey(v)) : Field.ofTelemetry(key);
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

  const measure = measureOf(v);
  const events = p.data === "event";
  const measures: Output[] = [];
  if (p.data === "metric" && (pivot || wantsUnit(p, v)))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  measures.push(
    output(
      "value",
      { type: "scaled", measure, by: p.unit === "MiB" ? mib : 1 },
      "float8",
    ),
    events
      ? output("samples", { type: "aggregate", fn: "sum", of: "value" })
      : output("samples", { type: "count" }, "int"),
  );

  const where = and(Event.matching(p, end), rowsOf(p, v));
  const from: Relation = events
    ? { type: "analysis_events", where }
    : metricOf(v.of[0]) === cpuPercent
      ? { type: "cpu_readings", window: Event.matching(p, end), where }
      : { type: "events", where };
  return { from, by, measures, having: { type: "present", measure } };
}

/**
 * The aggregates a panel shows at `end`, one per value; their cells together
 * make the panel's points.
 */
export function seriesAggregates(
  p: Panel,
  end: Date,
  buckets: boolean,
): Aggregate[] {
  if (p.group === "slot_total")
    return [slotTotalSeries(p, p.values[0], end, buckets)];
  return p.values.map((v) =>
    p.data === "daily"
      ? dailySeries(p, v, end, buckets)
      : valueSeries(p, v, end, buckets),
  );
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
  const daily = p.data === "daily";
  if (daily && name !== "source" && name !== "day") return null;
  const field = daily
    ? Field.ofDailySet(name as "day" | "source")
    : Field.ofTelemetry(name);
  const sets = p.values.map((v) => setOf(v.of[0]) ?? "");
  const scope = (extra?: "search"): Relation => {
    if (daily) {
      const where = DailySet.scope(p, sets, end);
      return {
        type: "daily_sets",
        where: extra ? and(where, DailySet.FieldMatches(field, search)) : where,
      };
    }
    const names = p.values.flatMap((v) => {
      const m = metricOf(v.of[0]);
      return m === undefined ? [] : [m === cpuPercent ? "cpu.usage" : m];
    });
    const kind: Event.Spec =
      p.data === "metric"
        ? and(Event.Kind("metric"), Event.Named(names))
        : kindOf(p.data);
    const where: Event.Spec = and(
      Event.matching(p, end),
      kind,
      ...(extra ? [Event.FieldMatches(field, search)] : []),
    );
    return p.data === "event"
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
