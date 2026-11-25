import { type SQLFragment, sql } from "../../infra/db/sql";
import type { Field } from "../../models/field";

const identifier = /^[a-z_][a-z0-9_]*$/;
export function column(name: string): SQLFragment {
  if (!identifier.test(name)) throw Error(`invalid column ${name}`);
  return sql.raw(name);
}
export function alias(name: string): SQLFragment {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    throw Error(`invalid alias ${name}`);
  return sql.raw(`"${name}"`);
}

const japaneseDate = sql`(at AT TIME ZONE 'Asia/Tokyo')::date`;
const scalar = sql.raw("('number','boolean','string')");
const decimal = "^[+-]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$";

/** The value rows are grouped by. */
export function label(f: Field): SQLFragment {
  switch (f.type) {
    case "column":
      return column(f.name);
    case "attr":
      return sql`coalesce(attrs->>${f.key},'')`;
    case "time":
      return sql`to_char(date_bin(make_interval(secs=>${f.seconds}::int),at,'2000-01-01T00:00:00Z'::timestamptz) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
    case "bin":
      return sql`date_bin(make_interval(secs=>${f.seconds}::int),${column(f.of)},'2000-01-01'::timestamptz)`;
    case "day":
      return sql`${japaneseDate}::text`;
    case "date":
      return sql`${column(f.column)}::text`;
    case "midnight":
      return sql`${column(f.column)}::timestamp AT TIME ZONE 'Asia/Tokyo'`;
    case "instant":
      return sql`${f.at}::timestamptz`;
    case "text":
      return sql`${f.value}::text`;
    case "concat":
      return sql.join(f.parts.map(label), ` || ${quote(f.separator)} || `);
    case "tuple":
      return sql`ARRAY[${sql.join(f.fields.map(label), ",")}]::text[]`;
    case "observed":
      return observed(f.of).text;
  }
}

function quote(s: string) {
  return `'${s.replaceAll("'", "''")}'`;
}

/** The text and number a condition compares; null where not comparable. */
export function observed(f: Field): { text: SQLFragment; num: SQLFragment } {
  switch (f.type) {
    case "time":
      return { text: sql`at::text`, num: sql`extract(epoch from at)*1000` };
    case "day":
    case "date": {
      const day = f.type === "day" ? japaneseDate : column(f.column);
      return {
        text: sql`${day}::text`,
        num: sql`(${day}-date '1970-01-01')::float8*86400000`,
      };
    }
    case "attr": {
      const value = sql`attrs->>${f.key}`;
      return {
        text: sql`CASE WHEN json_typeof(attrs->${f.key}) IN ${scalar} THEN ${value} END`,
        num: sql`CASE WHEN ${value} ~ ${decimal} AND pg_input_is_valid(${value},'double precision') THEN (${value})::float8 END`,
      };
    }
    default:
      return { text: label(f), num: sql`null::float8` };
  }
}

/** Shared leaves for field conditions of any relation. */
export function fieldCondition(
  spec:
    | { type: "FieldIn"; field: Field; values: readonly string[] }
    | { type: "FieldRange"; field: Field; min?: number; max?: number }
    | { type: "FieldMatches"; field: Field; search: string },
): SQLFragment {
  const { text, num } = observed(spec.field);
  switch (spec.type) {
    case "FieldIn":
      return spec.values.length
        ? sql`${text} IN (${sql.list([...spec.values])})`
        : sql`false`;
    case "FieldRange": {
      const parts: SQLFragment[] = [];
      if (spec.min !== undefined) parts.push(sql`${num}>=${spec.min}::float8`);
      if (spec.max !== undefined) parts.push(sql`${num}<=${spec.max}::float8`);
      return parts.length ? sql.join(parts, " AND ") : sql`true`;
    }
    case "FieldMatches":
      return sql`${text} IS NOT NULL AND length(${text})<=512 AND strpos(lower(${text}),lower(${spec.search}::text))>0`;
  }
}
