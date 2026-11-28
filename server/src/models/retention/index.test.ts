import { expect, test } from "bun:test";
import { claimToSQL } from "../../repositories/event/postgres/common";
import { type RetentionRecord, RetentionRule } from ".";

const hour = 3600000;
const now = new Date("2026-11-28T00:00:00Z");
const samples: RetentionRule = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "コンテナの CPU とメモリ",
  data: "metric",
  names: ["cpu.usage", "memory.current"],
  keep: 7 * 1440,
};
const forever: RetentionRule = {
  id: "00000000-0000-4000-8000-000000000002",
  title: "checkout は残す",
  conditions: [{ field: "source", values: ["checkout"] }],
  keep: null,
};
const record = (
  rule: RetentionRule,
  position: number,
  sweptUntil: Date | null = null,
): RetentionRecord => ({ rule, position, sweptUntil });

test("a rule names a kind of rows and their exact names", () => {
  const q = claimToSQL(RetentionRule.claim([samples], 0));
  expect(q.query).toBe("(kind=? AND name IN (?, ?))");
  expect(q.params).toEqual(["metric", "cpu.usage", "memory.current"]);
});

test("rows an earlier rule matches are left to it, even where its condition is unknown", () => {
  const q = claimToSQL(RetentionRule.claim([forever, samples], 1));
  expect(q.query).toBe(
    "((kind=? AND name IN (?, ?)) AND NOT (coalesce(source IN (?),false)))",
  );
  expect(q.params).toContain("checkout");
});

test("rows no rule matches are the rest, kept forever", () => {
  const q = claimToSQL(RetentionRule.unclaimed([forever, samples]));
  expect(q.query).toBe(
    "(true AND NOT (coalesce(source IN (?),false) OR coalesce((kind=? AND name IN (?, ?)),false)))",
  );
  expect(claimToSQL(RetentionRule.unclaimed([])).query).toBe("true");
});

test("a sweep starts just before the oldest row and goes an hour at a time", () => {
  const earliest = new Date(now.getTime() - 7 * 86400000 - 2.5 * hour);
  const steps = RetentionRule.plan([record(samples, 0)], now, earliest);
  expect(steps.map((s) => s.to.getTime() - s.from.getTime())).toEqual([
    hour,
    hour,
    0.5 * hour + 1,
  ]);
  expect(steps[0]?.from.getTime()).toBe(earliest.getTime() - 1);
  expect(steps[0]?.previous).toBeNull();
  expect(steps[1]?.previous).toEqual(steps[0]?.to as Date);
  expect(steps.at(-1)?.to).toEqual(new Date(now.getTime() - 7 * 86400000));
});

test("a sweep resumes where it stopped and waits until it falls a minute behind", () => {
  const limit = now.getTime() - 7 * 86400000;
  const behind = RetentionRule.plan(
    [record(samples, 0, new Date(limit - 90000))],
    now,
    null,
  );
  expect(behind).toHaveLength(1);
  expect(behind[0]?.from).toEqual(new Date(limit - 90000));
  expect(
    RetentionRule.plan(
      [record(samples, 0, new Date(limit - 30000))],
      now,
      null,
    ),
  ).toEqual([]);
});

test("rules kept forever are not swept, but still decide their rows first", () => {
  const steps = RetentionRule.plan(
    [record(samples, 1), record(forever, 0)],
    now,
    new Date(now.getTime() - 8 * 86400000),
  );
  expect(new Set(steps.map((s) => s.id))).toEqual(new Set([samples.id]));
  expect(steps[0]?.earlier).toHaveLength(1);
  expect(steps).toHaveLength(RetentionRule.stepsPerTick);
});

test("with no rows there is nothing to sweep", () => {
  expect(RetentionRule.plan([record(samples, 0)], now, null)).toEqual([]);
  expect(RetentionRule.needsEarliest([record(samples, 0)])).toBe(true);
  expect(RetentionRule.needsEarliest([record(forever, 0)])).toBe(false);
});
