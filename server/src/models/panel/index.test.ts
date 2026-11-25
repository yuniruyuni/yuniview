import { describe, expect, test } from "bun:test";
import { blankPanel, cpuPercent, type Panel } from "../../../../shared/console";
import { seriesAggregate, toPoint } from ".";

const end = new Date("2026-11-24T00:00:00Z");
const groups = (p: Panel, buckets = true) =>
  seriesAggregate(p, end, buckets).by.map((g) => g.as);

describe("seriesAggregate", () => {
  test("charts divide by bucket and series", () => {
    const a = seriesAggregate(blankPanel, end, true);
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
    expect(seriesAggregate(p, end, true).by[0].field).toEqual({
      type: "instant",
      at: end,
    });
  });
  test("application events read occurrences and weigh samples", () => {
    const a = seriesAggregate({ ...blankPanel, measure: "events" }, end, true);
    expect(a.from.type).toBe("analysis_events");
    expect(a.measures[1].measure).toEqual({
      type: "aggregate",
      fn: "sum",
      of: "value",
    });
  });
  test("CPU percent derives readings from counters", () => {
    const p = { ...blankPanel, measure: "metric" as const, metric: cpuPercent };
    expect(seriesAggregate(p, end, true).from.type).toBe("cpu_readings");
  });
  test("slot totals average each slot per minute before adding", () => {
    const p: Panel = {
      ...blankPanel,
      measure: "metric",
      metric: "memory.current",
      group: "slot_total",
    };
    const outer = seriesAggregate(p, end, true);
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
      measure: "distinct",
      distinct: { dataset: "daily", field: "visit.browser" },
      minutes: 4320,
    };
    const a = seriesAggregate(p, end, true);
    expect(a.from.type).toBe("aggregate");
    expect(a.by[0].field).toEqual({ type: "midnight", column: "day" });
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
