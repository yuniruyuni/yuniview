import { expect, test } from "bun:test";
import { defaults } from "../../../../../shared/console";
import { routes } from "../../../models/overview";
import { aggregateToSQL } from "./common";

test("an aggregate compiles to one grouped query with parameters", () => {
  const end = new Date("2026-11-24T00:00:00Z");
  const q = aggregateToSQL(
    routes(
      {
        ...defaults,
        conditions: [{ field: "source", values: ["checkout"] }],
      },
      end,
    ),
  );
  expect(q.query).toStartWith(
    'SELECT source AS "source",name AS "name",(count(*))::int AS "requests"',
  );
  expect(q.query).toContain(
    "(array_agg(trace ORDER BY value DESC NULLS LAST) FILTER(WHERE trace<>''))[1]",
  );
  expect(q.query).toEndWith(" GROUP BY 1,2");
  expect(q.params).toContain("checkout");
  expect(q.params).toContain(end);
});

test("rates read the increase of each container's counter per second", () => {
  const q = aggregateToSQL({
    from: { type: "rates", where: { type: "All" } as never },
    by: [],
    measures: [],
  });
  expect(q.query).toContain("(value-prev)/extract(epoch FROM at-prev_at)");
  expect(q.query).toContain(
    "PARTITION BY source, workload, instance, slot, revision, name",
  );
});
