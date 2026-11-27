import { describe, expect, test } from "bun:test";
import { blankPanel, type Point } from "../../../../shared/console";
import { Monitor, type MonitorRecord, sameJson } from ".";

const monitor: Monitor = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "errors",
  panel: {
    ...blankPanel,
    data: "request",
    values: [{ agg: "ratio", of: ["failed"] }],
  },
  threshold: 2,
  operator: "above",
  minimum: 10,
  missing: "no_data",
  notify: false,
};
const point = (value: number, samples: number): Point => ({
  bucket: "",
  series: "checkout",
  value,
  samples,
});

describe("Monitor.verdict", () => {
  test("alerts when any series with enough samples breaches", () => {
    expect(Monitor.verdict(monitor, [point(1, 50), point(5, 10)])).toEqual({
      state: "alert",
      value: 5,
    });
  });
  test("ignores series below the sample minimum", () => {
    expect(Monitor.verdict(monitor, [point(9, 9), point(1, 10)])).toEqual({
      state: "ok",
      value: 1,
    });
  });
  test("applies the missing-data policy without eligible series", () => {
    expect(Monitor.verdict(monitor, []).state).toBe("no_data");
    expect(
      Monitor.verdict({ ...monitor, missing: "alert" }, [point(9, 1)]).state,
    ).toBe("alert");
  });
  test("below compares the minimum", () => {
    expect(
      Monitor.verdict({ ...monitor, operator: "below" }, [
        point(1, 10),
        point(3, 10),
      ]),
    ).toEqual({ state: "alert", value: 1 });
  });
});

describe("Monitor.revise", () => {
  const stored: MonitorRecord = {
    definition: monitor,
    state: "alert",
    evaluated: new Date("2026-01-01T00:00:00Z"),
    value: 5,
    version: "v",
  };
  test("new monitors start pending", () => {
    expect(Monitor.revise(null, monitor)).toMatchObject({
      state: "pending",
      evaluated: null,
    });
  });
  test("an unchanged definition keeps its evaluation", () => {
    expect(Monitor.revise(stored, { ...monitor }).evaluated).toEqual(
      stored.evaluated,
    );
  });
  test("a changed definition is evaluated again but keeps its state", () => {
    const revised = Monitor.revise(stored, { ...monitor, threshold: 3 });
    expect(revised).toMatchObject({ state: "alert", evaluated: null });
  });
});

test("sameJson ignores key order and undefined members like jsonb", () => {
  expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(
    true,
  );
  expect(sameJson({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  expect(sameJson({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
});

test("a monitor judges the latest minute whose rows have all arrived", () => {
  const end = (at: string) => Monitor.windowEnd(new Date(at)).toISOString();
  expect(end("2026-11-28T00:02:14Z")).toBe("2026-11-28T00:00:00.000Z");
  expect(end("2026-11-28T00:02:15Z")).toBe("2026-11-28T00:01:00.000Z");
});
