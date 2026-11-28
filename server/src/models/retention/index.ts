import type { RetentionRule as Rule } from "../../../../shared/console";
import { and, type Comp, defineSpecs, type SpecsOf } from "../common";
import { Event } from "../event";
import { kindOf } from "../panel";

/** How long rows a filter picks out are kept; see the shared type. */
export type RetentionRule = Rule;
export { retentionRule } from "./schema";

/** A rule with its place in the order and how far its sweep has reached. */
export interface RetentionRecord {
  rule: RetentionRule;
  position: number;
  /** Rows at or before this time have been swept; null to start over. */
  sweptUntil: Date | null;
}

/** Rows a rule decides: it matches them and no earlier rule does. */
export interface Claim {
  matches: Event.Spec;
  /** What earlier rules match; those rows are theirs to decide. */
  earlier: Event.Spec[];
}

/** One sweep step: rows of `(from, to]` a rule decides are deleted. */
export interface SweepStep extends Claim {
  id: string;
  /** How far the rule's sweep had reached before this step, as stored. */
  previous: Date | null;
  from: Date;
  to: Date;
}

export namespace RetentionRule {
  const _specs = defineSpecs({
    ById: (id: string) => ({ id }),
  });
  export const ById = _specs.ById;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /** One hour of rows per statement, so a sweep of history stays bounded. */
  export const stepMs = 3600000;
  /** Steps per tick, across rules. */
  export const stepsPerTick = 4;
  /**
   * How far a sweep may fall behind before it runs again. A rule is swept
   * about once a minute rather than on every tick, so an idle sweep costs
   * little and leaves few records of itself.
   */
  export const lagMs = 60000;

  /** Rows the rule matches, compiled like a worksheet's conditions. */
  export function matches(rule: RetentionRule): Event.Spec {
    return and(
      rule.data ? kindOf(rule.data) : and(),
      rule.names ? Event.Named(rule.names) : and(),
      Event.conditions(rule.conditions),
    );
  }

  /** What the rule at `index` of the ordered rules decides. */
  export function claim(
    ordered: readonly RetentionRule[],
    index: number,
  ): Claim {
    return {
      matches: matches(ordered[index] as RetentionRule),
      earlier: ordered.slice(0, index).map(matches),
    };
  }

  /** The rows no rule decides, kept forever. */
  export function unclaimed(ordered: readonly RetentionRule[]): Claim {
    return { matches: and(), earlier: ordered.map(matches) };
  }

  /** Records in the order rules are read. */
  export function ordered(records: readonly RetentionRecord[]) {
    return [...records].sort((a, b) => a.position - b.position);
  }

  /**
   * The next steps of the sweep. Each rule with a finite period resumes where
   * it stopped, or just before `earliest` (the oldest stored row) when it
   * starts over, and goes up to `now` less its period, an hour at a time.
   */
  export function plan(
    records: readonly RetentionRecord[],
    now: Date,
    earliest: Date | null,
  ): SweepStep[] {
    const sorted = ordered(records);
    const rules = sorted.map((r) => r.rule);
    const steps: SweepStep[] = [];
    sorted.forEach((r, i) => {
      if (r.rule.keep === null) return;
      const limit = now.getTime() - r.rule.keep * 60000;
      // Windows exclude their start, so begin a moment before the oldest row.
      let from = r.sweptUntil?.getTime() ?? (earliest?.getTime() ?? limit) - 1;
      if (limit - from < lagMs) return;
      let previous = r.sweptUntil;
      while (from < limit && steps.length < stepsPerTick) {
        const to = new Date(Math.min(from + stepMs, limit));
        steps.push({
          id: r.rule.id,
          ...claim(rules, i),
          previous,
          from: new Date(from),
          to,
        });
        previous = to;
        from = to.getTime();
      }
    });
    return steps;
  }

  /** Whether any rule starts over and needs the oldest stored row. */
  export function needsEarliest(records: readonly RetentionRecord[]) {
    return records.some((r) => r.rule.keep !== null && !r.sweptUntil);
  }
}
