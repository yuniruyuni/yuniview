import type { RetentionRuleView } from "../../../../shared/console";
import { RetentionRule } from "../../models/retention";
import type { ReadContext } from "../context";
import { usecase } from "../runner";

const dayMs = 86400000;

/** About how many rows of the last day the rule at `index` of `rules` decides. */
function perDay(ctx: ReadContext, rules: RetentionRule[], index: number) {
  return ctx.repos.events.estimate(
    RetentionRule.claim(rules, index),
    new Date(ctx.now.getTime() - dayMs),
    ctx.now,
  );
}

/** The rules in order, each with about how many rows it decided over the last day. */
export const listRules = () =>
  usecase({
    read: async (ctx): Promise<RetentionRuleView[]> => {
      const records = await ctx.repos.retentionRules.list();
      const rules = records.map((r) => r.rule);
      return Promise.all(
        records.map(async (r, i) => ({
          rule: r.rule,
          perDay: await perDay(ctx, rules, i),
          sweptUntil: r.sweptUntil?.toISOString() ?? null,
        })),
      );
    },
  });

/**
 * About how many rows of the last day a rule would decide in its place, or last when new,
 * before it is saved.
 */
export const previewRule = (rule: RetentionRule) =>
  usecase({
    read: async (ctx) => {
      const rules = (await ctx.repos.retentionRules.list()).map((r) => r.rule);
      const index = rules.findIndex((r) => r.id === rule.id);
      if (index < 0) rules.push(rule);
      else rules[index] = rule;
      return perDay(ctx, rules, index < 0 ? rules.length - 1 : index);
    },
  });

// Any change to the rules sweeps every rule again from the oldest row, so
// the new order and periods apply to rows already stored too.

export const saveRule = (rule: RetentionRule) =>
  usecase({
    write: async (ctx) => {
      await ctx.repos.retentionRules.upsert(rule);
      await ctx.repos.retentionRules.restart();
      return true as const;
    },
  });

export const removeRule = (id: string) =>
  usecase({
    write: async (ctx) => {
      const removed = await ctx.repos.retentionRules.delete(
        RetentionRule.ById(id),
      );
      await ctx.repos.retentionRules.restart();
      return removed > 0;
    },
  });

export const reorderRules = (ids: readonly string[]) =>
  usecase({
    write: async (ctx) => {
      await ctx.repos.retentionRules.reorder(ids);
      await ctx.repos.retentionRules.restart();
      return true as const;
    },
  });
