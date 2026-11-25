import {
  type FilterField,
  isAttribute,
  isTimeField,
} from "../../../../shared/console";

/**
 * A dimension of a stored row. The same field both narrows rows (as a
 * condition) and divides them (as a group key), so selection and aggregation
 * share one vocabulary.
 */
export type Field =
  /** A plain column of the relation, such as source, slot, name or key. */
  | { readonly type: "column"; readonly name: string }
  /** A scalar attribute in `attrs`. */
  | { readonly type: "attr"; readonly key: string }
  /** The UTC bucket of `at`, labelled as `YYYY-MM-DDTHH:MM:SSZ`. */
  | { readonly type: "time"; readonly seconds: number }
  /** The bucket start of a timestamp column, kept as a timestamp. */
  | { readonly type: "bin"; readonly seconds: number; readonly of: string }
  /** The Japanese calendar date of `at`. */
  | { readonly type: "day" }
  /** A date column, such as the day of a daily set. */
  | { readonly type: "date"; readonly column: string }
  /** Japanese midnight of a date column, as a timestamp. */
  | { readonly type: "midnight"; readonly column: string }
  /** The same instant for every row. */
  | { readonly type: "instant"; readonly at: Date }
  /** The same text for every row. */
  | { readonly type: "text"; readonly value: string }
  /** Text parts joined by a separator. */
  | {
      readonly type: "concat";
      readonly parts: readonly Field[];
      readonly separator: string;
    }
  /** An ordered compound key of several fields. */
  | { readonly type: "tuple"; readonly fields: readonly Field[] }
  /**
   * The value a condition compares, rather than the grouping label. For
   * attributes this is null unless the attribute is a scalar.
   */
  | { readonly type: "observed"; readonly of: Field };

export namespace Field {
  export const column = (name: string): Field => ({ type: "column", name });
  export const attr = (key: string): Field => ({ type: "attr", key });
  export const text = (value: string): Field => ({ type: "text", value });
  export const instant = (at: Date): Field => ({ type: "instant", at });
  export const bin = (seconds: number, of = "at"): Field => ({
    type: "bin",
    seconds,
    of,
  });
  export const observed = (of: Field): Field => ({ type: "observed", of });

  /** One field as itself, several as a compound key, none as empty text. */
  export function key(fields: readonly Field[]): Field {
    if (fields.length === 0) return text("");
    if (fields.length === 1) return fields[0];
    return { type: "tuple", fields };
  }

  /** The stored dimension a filter or shelf name refers to in telemetry. */
  export function ofTelemetry(name: Exclude<FilterField, "log">): Field {
    if (isTimeField(name))
      return { type: "time", seconds: Number(name.slice(5)) };
    if (name === "day") return { type: "day" };
    if (isAttribute(name)) return attr(name.slice(5));
    return column(name);
  }

  /** The stored dimension a filter or shelf name refers to in daily sets. */
  export function ofDailySet(name: "day" | "source"): Field {
    return name === "day" ? { type: "date", column: "day" } : column("source");
  }
}
