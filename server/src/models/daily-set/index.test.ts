import { expect, test } from "bun:test";
import { blankPanel } from "../../../../shared/console";
import { DailySet, japaneseDate } from ".";

test("japaneseDate follows Japanese midnight", () => {
  expect(japaneseDate(new Date("2026-11-23T14:59:59Z"))).toBe("2026-11-23");
  expect(japaneseDate(new Date("2026-11-23T15:00:00Z"))).toBe("2026-11-24");
  expect(japaneseDate(new Date("2026-11-23T15:00:00Z"), 2)).toBe("2026-11-22");
});

test("a daily panel covers whole Japanese days ending at its end", () => {
  const spec = DailySet.scope(
    {
      ...blankPanel,
      measure: "distinct",
      distinct: { dataset: "daily", field: "visit.account" },
      minutes: 2 * 1440,
    },
    new Date("2026-11-24T00:00:00Z"),
  );
  expect(spec).toMatchObject({
    type: "And",
    items: [
      { type: "Named", field: "visit.account" },
      { type: "DayBetween", from: "2026-11-23", to: "2026-11-24" },
    ],
  });
});
