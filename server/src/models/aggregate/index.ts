import type { Batch } from "../batch";
import type { DailySet } from "../daily-set";
import type { Event } from "../event";
import type { Field } from "../field";

/**
 * The rows an aggregate reads. Each relation carries the spec of its own
 * rows, so selection stays in the entity's vocabulary.
 */
export type Relation =
  | { readonly type: "events"; readonly where: Event.Spec }
  /** Application events plus routed server spans counted as `http.request`. */
  | { readonly type: "analysis_events"; readonly where: Event.Spec }
  /**
   * Events plus `derived:cpu.percent` readings computed from consecutive
   * `cpu.usage` counters of each container within `window`.
   */
  | {
      readonly type: "cpu_readings";
      readonly window: Event.Spec;
      readonly where: Event.Spec;
    }
  | { readonly type: "daily_sets"; readonly where: DailySet.Spec }
  | { readonly type: "batches"; readonly where: Batch.Spec }
  /** Scalar attribute keys (column `key`) of the latest `sample` rows. */
  | {
      readonly type: "attribute_keys";
      readonly from: "events" | "analysis_events";
      readonly where: Event.Spec;
      readonly sample: number;
    }
  /** The cells of another aggregate, by their output names. */
  | { readonly type: "aggregate"; readonly of: Aggregate };

/** A row predicate usable inside an aggregate (FILTER) over events. */
type EventFilter = Event.Spec;

export type Measure =
  | { readonly type: "count"; readonly where?: EventFilter }
  /** Percentage of rows matching `where`. */
  | { readonly type: "percent"; readonly where: EventFilter }
  | {
      readonly type: "aggregate";
      readonly fn: "avg" | "max" | "min" | "sum";
      readonly of: string;
    }
  | {
      readonly type: "percentile";
      readonly fraction: number;
      readonly of: string;
      readonly where?: EventFilter;
    }
  /** Number of different non-empty values of a field; a tuple counts combinations whose parts are all non-empty. */
  | { readonly type: "distinct"; readonly of: Field }
  /** The column's value when every row agrees, otherwise null. */
  | { readonly type: "uniform"; readonly of: string }
  /** `trace` of the row with the largest `value`, skipping rows without one. */
  | { readonly type: "slowest_trace" }
  /** Whether every observed value of the field is numeric. */
  | { readonly type: "numeric"; readonly of: Field }
  /** Smallest or largest numeric value of the field. */
  | { readonly type: "bound"; readonly fn: "min" | "max"; readonly of: Field }
  | { readonly type: "scaled"; readonly measure: Measure; readonly by: number };

export interface Group {
  readonly as: string;
  readonly field: Field;
}
export interface Output {
  readonly as: string;
  readonly measure: Measure;
  readonly cast?: "int" | "float8";
}
export type Having =
  | { readonly type: "present"; readonly measure: Measure }
  | { readonly type: "rows"; readonly count: number };

/**
 * Divides the rows of a relation by its groups and measures each part. Each
 * distinct combination of group values is one {@link Cell}.
 */
export interface Aggregate {
  readonly from: Relation;
  readonly by: readonly Group[];
  readonly measures: readonly Output[];
  readonly having?: Having;
}

/** One measured part of an aggregate, keyed by group and output names. */
export type Cell = Record<string, unknown>;

export namespace Cell {
  /** An aggregate specifies exactly which cells exist. */
  export type Spec = Aggregate;
  /** Group or output names. Group names are the default order. */
  export type SortKey = string;
}

export namespace Aggregate {
  export const group = (as: string, field: Field): Group => ({ as, field });
  export const output = (
    as: string,
    measure: Measure,
    cast?: Output["cast"],
  ): Output => ({ as, measure, cast });
  /** Cells of `inner`, as the relation of another aggregate. */
  export const of = (inner: Aggregate): Relation => ({
    type: "aggregate",
    of: inner,
  });
}
