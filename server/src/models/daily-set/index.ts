import type { Panel } from "../../../../shared/console";
import { and, type Comp, defineSpecs, type SpecsOf } from "../common";
import { Field } from "../field";

/**
 * One anonymous member of a named set for a service and Japanese date. The
 * digest is only comparable within the same day and service; an empty digest
 * records that the day was measured with no members.
 */
export interface DailySet {
  day: string;
  source: string;
  field: string;
  digest: string;
}

/** Members are kept for 30 Japanese days including today. */
export const retainedDays = 30;

const japanOffset = 9 * 3600000;
/** The Japanese calendar date of an instant, as `YYYY-MM-DD`. */
export function japaneseDate(at: Date, minusDays = 0) {
  return new Date(at.getTime() + japanOffset - minusDays * 86400000)
    .toISOString()
    .slice(0, 10);
}

export namespace DailySet {
  const _specs = defineSpecs({
    Named: (field: string) => ({ field }),
    /** Inclusive range of `YYYY-MM-DD` dates. */
    DayBetween: (from: string, to: string) => ({ from, to }),
    Before: (day: string) => ({ day }),
    Source: (source: string) => ({ source }),
    FieldIn: (field: Field, values: readonly string[]) => ({ field, values }),
    FieldRange: (field: Field, min?: number, max?: number) => ({
      field,
      min,
      max,
    }),
    FieldMatches: (field: Field, search: string) => ({ field, search }),
  });
  export const Named = _specs.Named;
  export const DayBetween = _specs.DayBetween;
  export const Before = _specs.Before;
  export const Source = _specs.Source;
  export const FieldIn = _specs.FieldIn;
  export const FieldRange = _specs.FieldRange;
  export const FieldMatches = _specs.FieldMatches;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /** Members a daily-set panel covers: its set, its days ending at `end`. */
  export function scope(p: Panel, end: Date): Spec {
    const specs: Spec[] = [
      Named(p.distinct?.field ?? ""),
      DayBetween(
        japaneseDate(end, Math.ceil(p.minutes / 1440) - 1),
        japaneseDate(end),
      ),
    ];
    if (p.source) specs.push(Source(p.source));
    for (const c of p.conditions ?? []) {
      if (c.field !== "day" && c.field !== "source") continue;
      const field = Field.ofDailySet(c.field);
      if (c.values) specs.push(FieldIn(field, c.values));
      if (c.min !== undefined || c.max !== undefined)
        specs.push(FieldRange(field, c.min, c.max));
    }
    return and(...specs);
  }

  /** Members older than the retained window ending today in Japan. */
  export function expired(now: Date): Spec {
    return Before(japaneseDate(now, retainedDays - 1));
  }
}
