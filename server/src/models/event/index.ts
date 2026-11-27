import type {
  EventRow,
  FieldCondition,
  Filter,
} from "../../../../shared/console";
import { and, type Comp, defineSpecs, type SpecsOf } from "../common";
import { Field } from "../field";

/** One stored log line, span, metric point or application event. */
export type Event = EventRow;

export namespace Event {
  export type Kind = "log" | "span" | "metric" | "event";
  export type SortKey = "at" | "source" | "batchId" | "ordinal";
  export const order: readonly SortKey[] = [
    "at",
    "source",
    "batchId",
    "ordinal",
  ];

  const _specs = defineSpecs({
    /** `from < at <= to`. */
    Window: (from: Date, to: Date) => ({ from, to }),
    /** The field's observed value is one of `values`. Empty matches nothing. */
    FieldIn: (field: Field, values: readonly string[]) => ({ field, values }),
    /** The field's numeric value lies within the inclusive bounds. */
    FieldRange: (field: Field, min?: number, max?: number) => ({
      field,
      min,
      max,
    }),
    /** The field has a short observed value containing `search`, ignoring case. */
    FieldMatches: (field: Field, search: string) => ({ field, search }),
    Kind: (kind: Kind) => ({ kind }),
    /** Spans that start a request in the service (server spans). */
    Entry: () => ({}),
    Failed: () => ({}),
    Named: (names: readonly string[]) => ({ names }),
    HasValue: () => ({}),
    /** Body or name contains the text, ignoring case. */
    Text: (text: string) => ({ text }),
    Trace: (trace: string) => ({ trace }),
  });
  export const Window = _specs.Window;
  export const FieldIn = _specs.FieldIn;
  export const FieldRange = _specs.FieldRange;
  export const FieldMatches = _specs.FieldMatches;
  export const Kind = _specs.Kind;
  export const Entry = _specs.Entry;
  export const Failed = _specs.Failed;
  export const Named = _specs.Named;
  export const HasValue = _specs.HasValue;
  export const Text = _specs.Text;
  export const Trace = _specs.Trace;

  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /** Field conditions of a worksheet, combined with AND. */
  export function conditions(list: readonly FieldCondition[] = []): Spec {
    const specs: Spec[] = [];
    for (const c of list) {
      if (c.field === "text") {
        if (c.contains) specs.push(Text(c.contains));
        continue;
      }
      const field = Field.ofTelemetry(c.field);
      if (c.values) specs.push(FieldIn(field, c.values));
      if (c.min !== undefined || c.max !== undefined)
        specs.push(FieldRange(field, c.min, c.max));
    }
    return and(...specs);
  }

  /** Rows within the filter's window ending at `end` that meet its conditions. */
  export function matching(f: Filter, end: Date): Spec {
    return and(
      conditions(f.conditions),
      Window(new Date(end.getTime() - 60000 * f.minutes), end),
    );
  }

  export function cursor(
    e: Event,
    keys: readonly SortKey[],
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const key of keys) {
      const value: unknown = e[key];
      result[key] = value instanceof Date ? value.toISOString() : String(value);
    }
    return result;
  }
}
