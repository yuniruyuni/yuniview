import { describe, expect, test } from "bun:test";
import { all, defineSpecs, not, or, type SpecsOf } from "../../models/common";
import { sql } from "./sql";
import { compToSQL } from "./sql-helpers";

const specs = defineSpecs({
  ById: (id: string) => ({ id }),
  ByName: (name: string) => ({ name }),
});
type S = SpecsOf<typeof specs>;
const leaf = (s: S) =>
  s.type === "ById" ? sql`id = ${s.id}` : sql`name = ${s.name}`;

describe("compToSQL", () => {
  test("expands leaves", () => {
    expect(compToSQL(specs.ById("a"), leaf)).toEqual({
      query: "id = ?",
      params: ["a"],
    });
  });
  test("composes AND/OR/NOT with method and function forms", () => {
    const spec = specs
      .ById("a")
      .and(or(specs.ByName("b"), not(specs.ByName("c"))));
    expect(compToSQL(spec, leaf)).toEqual({
      query: "(id = ? AND (name = ? OR NOT (name = ?)))",
      params: ["a", "b", "c"],
    });
  });
  test("All is the identity of and", () => {
    expect(compToSQL(all<S>(), leaf).query).toBe("true");
    expect(compToSQL(all<S>().and(specs.ById("a")), leaf).query).toBe("id = ?");
  });
});
