import {
  chartBucketSeconds,
  type DataKind,
  type Filter,
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
  type TopValue,
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
  fieldMeta,
  filter,
  filterField,
  monitor,
  panel,
  query,
  scope,
} from "./schema";

const { group, output } = Aggregate;

/** Rows of a kind of data, beyond the window and conditions. */
export function kindOf(data: DataKind): Event.Spec {
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
function rowsOf(data: DataKind, v: Value): Event.Spec {
  const metric = metricOf(v.of[0]);
  if (metric === undefined) return kindOf(data);
  return and(Event.Kind("metric"), Event.Named([metric]), Event.HasValue());
}

/** The relation a value reads: rates of a counter, or the rows themselves. */
function relationOf(
  p: Filter & { data: DataKind },
  v: Value,
  end: Date,
): Relation {
  const where = and(Event.matching(p, end), rowsOf(p.data, v));
  return v.agg === "rate"
    ? { type: "rates", where }
    : { type: "events", where };
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
          v.of.map((f) => Field.ofTelemetry(f as Exclude<FilterField, "text">)),
        ),
      };
    case "p50":
    case "p95":
    case "p99":
      return { type: "percentile", fraction: fractions[v.agg], of: "value" };
    case "rate":
      return { type: "aggregate", fn: "avg", of: "value" };
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

function wantsUnit(p: Panel, v: Value) {
  return p.display === "table" || Boolean(p.fieldUnits?.[valueKey(v)]);
}

/** The groups that divide a panel's cells, by how its shelves name them. */
function divisions(
  p: Panel,
  field: (a: ShelfAxis) => Field,
  bucket: Field,
): Group[] {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const by: Group[] = [
    group("bucket", bucket),
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
  return by;
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
  const visitors: Measure = { type: "aggregate", fn: "sum", of: "visitors" };
  return {
    from: Aggregate.of(perDay),
    by: divisions(
      p,
      field,
      !pivot && buckets
        ? { type: "midnight", column: "day" }
        : Field.instant(end),
    ),
    measures: [
      output("value", visitors, "float8"),
      output("samples", visitors, "int"),
    ],
  };
}

/**
 * Two-stage values: each `per` group is averaged within a minute, the
 * averages of a minute are added up, and the sums aggregated over time.
 * Agents sample independently, so a gauge of several containers is summed
 * this way rather than as raw readings.
 */
function perSeries(
  p: Panel,
  v: Value,
  end: Date,
  buckets: boolean,
  seconds: number,
): Aggregate {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "measure" ? Field.text(valueKey(v)) : Field.ofTelemetry(key);
  const outer = divisions(p, field, Field.text("")).slice(1);
  const per = v.per ?? [];
  const perMinute: Aggregate = {
    from: relationOf(p, v, end),
    by: [
      group("minute", Field.bin(60)),
      ...outer.map((g) => group(`g_${g.as}`, g.field)),
      ...per.map((d, i) => group(`p_${i}`, Field.ofTelemetry(d))),
    ],
    measures: [
      output("reading", { type: "aggregate", fn: "avg", of: "value" }),
      output("unit", { type: "aggregate", fn: "min", of: "unit" }),
    ],
  };
  const sums: Aggregate = {
    from: Aggregate.of(perMinute),
    by: [
      group("minute", Field.column("minute")),
      ...outer.map((g) => group(`g_${g.as}`, Field.column(`g_${g.as}`))),
    ],
    measures: [
      output("total", { type: "aggregate", fn: "sum", of: "reading" }),
      output("unit", { type: "aggregate", fn: "min", of: "unit" }),
    ],
  };
  const fn = v.agg === "min" || v.agg === "max" ? v.agg : "avg";
  const measures: Output[] = [];
  if (pivot || wantsUnit(p, v))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  measures.push(
    output("value", { type: "aggregate", fn, of: "total" }, "float8"),
    output("samples", { type: "count" }, "int"),
  );
  return {
    from: Aggregate.of(sums),
    by: [
      group(
        "bucket",
        buckets && !pivot ? Field.bin(seconds, "minute") : Field.instant(end),
      ),
      ...outer.map((g) => group(g.as, Field.column(`g_${g.as}`))),
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
  seconds: number,
): Aggregate {
  const pivot = p.display === "pivot" ? p.pivot : undefined;
  const field = (key: ShelfAxis): Field =>
    key === "measure" ? Field.text(valueKey(v)) : Field.ofTelemetry(key);
  const by = divisions(
    p,
    field,
    buckets && !pivot ? Field.bin(seconds) : Field.instant(end),
  );
  const measure = measureOf(v);
  const measures: Output[] = [];
  if (p.data === "metric" && (pivot || wantsUnit(p, v)))
    measures.push(
      output("metricUnit", { type: "aggregate", fn: "min", of: "unit" }),
    );
  measures.push(
    output("value", measure, "float8"),
    p.data === "event"
      ? output("samples", { type: "aggregate", fn: "sum", of: "value" })
      : output("samples", { type: "count" }, "int"),
  );
  return {
    from: relationOf(p, v, end),
    by,
    measures,
    having: { type: "present", measure },
  };
}

/**
 * The aggregates a panel shows at `end`, one per value; their cells together
 * make the panel's points.
 */
export function seriesAggregates(
  p: Panel,
  end: Date,
  buckets: boolean,
  seconds = chartBucketSeconds(p.minutes),
): Aggregate[] {
  return p.values.map((v) =>
    p.data === "daily"
      ? dailySeries(p, v, end, buckets)
      : v.per?.length
        ? perSeries(p, v, end, buckets, Math.max(60, seconds))
        : valueSeries(p, v, end, buckets, seconds),
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

/** A query's data, window and conditions, with the metrics its values read. */
export type Scope = Filter & { data: DataKind; values?: Value[] };

/** The rows a query reads within its window. */
function scopeOf(q: Scope, end: Date, extra?: Event.Spec): Relation {
  const metrics = (q.values ?? []).flatMap((v) => {
    const m = metricOf(v.of[0]);
    return m === undefined ? [] : [m];
  });
  const kind =
    q.data === "metric" && metrics.length
      ? and(Event.Kind("metric"), Event.Named(metrics))
      : kindOf(q.data);
  return {
    type: "events",
    where: and(Event.matching(q, end), kind, ...(extra ? [extra] : [])),
  };
}

/** Choices offered for a worksheet filter, ignoring the field's own condition. */
export function filterChoices(
  panel: Scope,
  name: Exclude<FilterField, "text">,
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
  const sets = (p.values ?? []).map((v) => setOf(v.of[0]) ?? "");
  const scope = (extra?: "search"): Relation => {
    if (daily) {
      const where = DailySet.scope(p, sets, end);
      return {
        type: "daily_sets",
        where: extra ? and(where, DailySet.FieldMatches(field, search)) : where,
      };
    }
    return scopeOf(
      p,
      end,
      extra ? Event.FieldMatches(field, search) : undefined,
    );
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

/** How many rows of a query have each value of a field. */
export function topValues(
  q: Scope,
  name: Exclude<FilterField, "text">,
  end: Date,
): Aggregate {
  return {
    from: scopeOf(q, end),
    by: [group("value", Field.observed(Field.ofTelemetry(name)))],
    measures: [output("count", { type: "count" }, "int")],
  };
}
export const topValueLimit = 12;
export function toTopValue(c: Cell): TopValue {
  return {
    value: c.value === null || c.value === undefined ? "" : String(c.value),
    count: Number(c.count),
  };
}

/** Attribute keys observed in recent rows of a query's data. */
export function attributeKeys(input: {
  data: DataKind;
  metric?: string;
  conditions?: Filter["conditions"];
  end: Date;
  minutes: number;
}): Aggregate {
  const specs: Event.Spec[] = [
    Event.matching(input, input.end),
    kindOf(input.data),
  ];
  if (input.metric) specs.push(Event.Named([input.metric]));
  return {
    from: { type: "attribute_keys", where: and(...specs), sample: 512 },
    by: [group("key", Field.column("key"))],
    measures: [],
  };
}
