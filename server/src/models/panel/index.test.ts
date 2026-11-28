import { describe, expect, test } from "bun:test";
import { asChart, blankPanel, type Panel } from "../../../../shared/console";
import {
  monitor as monitorSchema,
  panel as panelSchema,
  seriesAggregates,
  toPoint,
} from ".";

const end = new Date("2026-11-24T00:00:00Z");
const only = (p: Panel, buckets = true) => {
  const all = seriesAggregates(p, end, buckets);
  expect(all).toHaveLength(1);
  return all[0];
};
const groups = (p: Panel, buckets = true) =>
  only(p, buckets).by.map((g) => g.as);

describe("seriesAggregates", () => {
  test("charts divide by bucket and series", () => {
    const a = only(blankPanel);
    expect(a.from.type).toBe("events");
    expect(a.by[0]).toEqual({
      as: "bucket",
      field: { type: "bin", seconds: 90, of: "at" },
    });
    expect(a.measures.map((m) => m.as)).toEqual(["value", "samples"]);
  });
  test("pivots add column and facet groups at one instant", () => {
    const p: Panel = {
      ...blankPanel,
      display: "pivot",
      pivot: { row: ["source", "slot"], column: "measure", series: "revision" },
    };
    expect(groups(p)).toEqual(["bucket", "series", "column", "facet"]);
    expect(only(p).by[0].field).toEqual({ type: "instant", at: end });
  });
  test("each value is one aggregate labelled on the measure shelf", () => {
    const p: Panel = {
      ...blankPanel,
      values: [
        { agg: "count", of: [] },
        { agg: "p95", of: ["value"] },
        { agg: "distinct", of: ["source", "attr:http.route"] },
      ],
      display: "pivot",
      pivot: { row: "measure", column: "source" },
    };
    const all = seriesAggregates(p, end, true);
    expect(all.map((a) => a.by[1].field)).toEqual([
      { type: "text", value: "count()" },
      { type: "text", value: "p95(value)" },
      { type: "text", value: "distinct(source,attr:http.route)" },
    ]);
  });
  test("conditions narrow the rows, the text condition by body or name", () => {
    const a = only({
      ...blankPanel,
      conditions: [
        { field: "source", values: ["checkout"] },
        { field: "text", contains: "timeout" },
      ],
    });
    expect(JSON.stringify(a.from)).toContain('"type":"Text"');
    expect(JSON.stringify(a.from)).toContain('"checkout"');
  });
  test("a counter's rate reads per-second increases", () => {
    const a = only({
      ...blankPanel,
      data: "metric",
      values: [{ agg: "rate", of: ["metric:cpu.usage"] }],
    });
    expect(a.from.type).toBe("rates");
    expect(a.measures.at(-2)?.measure).toEqual({
      type: "aggregate",
      fn: "avg",
      of: "value",
    });
  });
  test("per averages each group per minute before adding", () => {
    const outer = only({
      ...blankPanel,
      data: "metric",
      values: [{ agg: "max", of: ["metric:memory.current"], per: ["slot"] }],
    });
    if (outer.from.type !== "aggregate") throw Error("nested");
    const sums = outer.from.of;
    if (sums.from.type !== "aggregate") throw Error("nested");
    expect(sums.from.of.by.map((g) => g.as)).toEqual([
      "minute",
      "g_series",
      "p_0",
    ]);
    expect(sums.measures[0].measure).toEqual({
      type: "aggregate",
      fn: "sum",
      of: "reading",
    });
    expect(outer.measures.at(-2)?.measure).toEqual({
      type: "aggregate",
      fn: "max",
      of: "total",
    });
  });
  test("daily sets count members per service and day, then sum", () => {
    const a = only({
      ...blankPanel,
      data: "daily",
      values: [{ agg: "daily", of: ["set:visit.browser"] }],
      minutes: 4320,
    });
    expect(a.from.type).toBe("aggregate");
    expect(a.by[0].field).toEqual({ type: "midnight", column: "day" });
  });
});

describe("panel schema", () => {
  test("rejects values the data cannot measure", () => {
    for (const values of [
      [{ agg: "p95", of: ["failed"] }],
      [{ agg: "avg", of: ["metric:memory.current"] }],
      [{ agg: "rate", of: ["value"] }],
      [{ agg: "sum", of: ["value"], per: ["slot"] }],
      [
        { agg: "count", of: [] },
        { agg: "count", of: [] },
      ],
    ])
      expect(panelSchema.safeParse({ ...blankPanel, values }).success).toBe(
        false,
      );
  });
  test("accepts conditions in place of the former filter fields", () => {
    expect(
      panelSchema.safeParse({
        ...blankPanel,
        conditions: [{ field: "text", contains: "x" }],
      }).success,
    ).toBe(true);
    expect(
      panelSchema.safeParse({ ...blankPanel, source: "checkout" }).data,
    ).not.toHaveProperty("source");
  });
});

describe("monitor panels", () => {
  const line = (pivot: NonNullable<Panel["pivot"]>): Panel => ({
    ...blankPanel,
    data: "request",
    values: [{ agg: "count", of: [] }],
    display: "pivot",
    pivot,
  });
  const monitor = (panel: Panel) => ({
    id: crypto.randomUUID(),
    title: "m",
    panel,
    threshold: 1,
    operator: "above",
    minimum: 1,
    missing: "no_data",
    notify: false,
  });
  test("a worksheet line of one value over time is a chart", () => {
    const p = line({
      row: ["measure"],
      column: ["time:60"],
      series: [],
      mark: "line",
      encoding: { color: "source" },
    });
    expect(asChart(p)).toMatchObject({ display: "chart", group: "source" });
    expect(asChart(p)).not.toHaveProperty("pivot");
    expect(asChart({ ...p, pivot: { ...p.pivot!, encoding: {} } })?.group).toBe(
      "all",
    );
    const parsed = monitorSchema.safeParse(monitor(p));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.panel).toMatchObject({
      display: "chart",
      group: "source",
    });
  });
  test("bars, two splits or time off the column stay pivots", () => {
    const pivots: NonNullable<Panel["pivot"]>[] = [
      { row: ["measure"], column: ["time:60"], mark: "bar" },
      { row: ["measure"], column: ["time:60"], series: ["source", "slot"] },
      { row: ["time:60"], column: ["measure"] },
      { row: ["measure"], column: ["source"] },
    ];
    for (const pivot of pivots) {
      const p = line(pivot);
      expect(asChart(p)).toBeUndefined();
      expect(monitorSchema.safeParse(monitor(p)).success).toBe(false);
    }
  });
});
test("toPoint turns compound keys into JSON and paths", () => {
  expect(
    toPoint({
      bucket: "b",
      series: ["a", "b"],
      column: "c",
      facet: ["x"],
      value: 1,
      samples: 2,
    }),
  ).toEqual({
    bucket: "b",
    series: '["a","b"]',
    rowPath: ["a", "b"],
    column: "c",
    facet: '["x"]',
    facetPath: ["x"],
    value: 1,
    samples: 2,
  });
});
