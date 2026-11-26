import { describe, expect, test } from "bun:test";
import {
  blankPanel,
  cpuPercent,
  type Panel,
  upgradePanel,
} from "../../../../shared/console";
import { panel as panelSchema, seriesAggregates, toPoint } from ".";

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
    expect(all[2].measures[0].measure).toMatchObject({
      measure: {
        type: "distinct",
        of: {
          type: "tuple",
          fields: [
            { type: "column", name: "source" },
            { type: "attr", key: "http.route" },
          ],
        },
      },
    });
  });
  test("application events read occurrences and weigh samples", () => {
    const a = only({
      ...blankPanel,
      data: "event",
      values: [{ agg: "sum", of: ["value"] }],
    });
    expect(a.from.type).toBe("analysis_events");
    expect(a.measures[1].measure).toEqual({
      type: "aggregate",
      fn: "sum",
      of: "value",
    });
  });
  test("CPU percent derives readings from counters", () => {
    const p: Panel = {
      ...blankPanel,
      data: "metric",
      values: [{ agg: "avg", of: [`metric:${cpuPercent}`] }],
    };
    expect(only(p).from.type).toBe("cpu_readings");
  });
  test("slot totals average each slot per minute before adding", () => {
    const p: Panel = {
      ...blankPanel,
      data: "metric",
      values: [{ agg: "avg", of: ["metric:memory.current"] }],
      group: "slot_total",
    };
    const outer = only(p);
    if (outer.from.type !== "aggregate") throw Error("nested");
    const totals = outer.from.of;
    expect(totals.having).toEqual({ type: "rows", count: 2 });
    if (totals.from.type !== "aggregate") throw Error("nested");
    expect(totals.from.of.by.map((g) => g.as)).toEqual([
      "minute",
      "source",
      "workload",
      "slot",
    ]);
  });
  test("daily sets count members per service and day, then sum", () => {
    const p: Panel = {
      ...blankPanel,
      data: "daily",
      values: [{ agg: "daily", of: ["set:visit.browser"] }],
      minutes: 4320,
    };
    const a = only(p);
    expect(a.from.type).toBe("aggregate");
    expect(a.by[0].field).toEqual({ type: "midnight", column: "day" });
  });
});

describe("panel schema", () => {
  const legacy = {
    ...blankPanel,
    data: undefined,
    values: undefined,
    measure: "metric",
    metric: "memory.current",
    aggregation: "max",
    display: "pivot",
    fieldUnits: { "metric/queue.depth": "s" },
    pivot: {
      row: "measure",
      column: "time:60",
      metrics: ["queue.depth"],
      metricOptions: [
        { metric: "queue.depth", aggregation: "sum", mark: "bar" },
      ],
      encoding: { color: "measure" },
      styleRules: [{ channel: "color", value: "queue.depth", index: 3 }],
    },
  };
  test("rewrites panels saved with a measure", () => {
    const p = panelSchema.parse(legacy);
    expect(p.data).toBe("metric");
    expect(p.values).toEqual([
      { agg: "max", of: ["metric:memory.current"] },
      { agg: "sum", of: ["metric:queue.depth"], mark: "bar" },
    ]);
    expect(p.pivot?.styleRules).toEqual([
      { channel: "color", value: "sum(metric:queue.depth)", index: 3 },
    ]);
    expect(p.fieldUnits).toEqual({ "metric/queue.depth": "s" });
  });
  test("moves the unit of a measure to its value", () => {
    const p = upgradePanel({
      ...blankPanel,
      measure: "latency",
      metric: "",
      aggregation: "avg",
      fieldUnits: { latency: "s" },
    }) as Panel;
    expect(p.values).toEqual([{ agg: "p95", of: ["value"] }]);
    expect(p.fieldUnits).toEqual({ "p95(value)": "s" });
  });
  test("rejects values the data cannot measure", () => {
    for (const values of [
      [{ agg: "p95", of: ["failed"] }],
      [{ agg: "avg", of: ["metric:memory.current"] }],
      [
        { agg: "count", of: [] },
        { agg: "count", of: [] },
      ],
    ])
      expect(panelSchema.safeParse({ ...blankPanel, values }).success).toBe(
        false,
      );
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
