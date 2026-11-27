import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { RetentionRecord, RetentionRule } from "../../../models/retention";
import type { DbReadCtx, DbWriteCtx } from "../../common/capability";
import type { IRetentionRuleRepository } from "../repository";

type Leaf = Exclude<RetentionRule.Spec, { type: "And" | "Or" | "Not" | "All" }>;
function specToSQL(spec: Leaf) {
  switch (spec.type) {
    case "ById":
      return sql`id=${spec.id}`;
  }
}
/** The key of the advisory lock one sweeping worker holds. */
const sweepLock = 0x72657465; // "rete"

export class RetentionRuleRepository implements IRetentionRuleRepository {
  async list(ctx: DbReadCtx): Promise<RetentionRecord[]> {
    return ctx.db.queryAll<RetentionRecord & Record<string, unknown>>(
      sql`SELECT definition AS rule,position,swept_until AS "sweptUntil" FROM retention_rules ORDER BY position,id`,
    );
  }
  async upsert(ctx: DbWriteCtx, rule: RetentionRule) {
    await ctx.db.queryRun(sql`INSERT INTO retention_rules(id,position,definition)
  VALUES(${rule.id},(SELECT coalesce(max(position)+1,0) FROM retention_rules),${JSON.stringify(rule)}::jsonb)
  ON CONFLICT(id) DO UPDATE SET definition=excluded.definition`);
  }
  async delete(ctx: DbWriteCtx, spec: RetentionRule.Spec) {
    return (
      await ctx.db.queryRun(
        sql`DELETE FROM retention_rules WHERE ${compToSQL(spec, specToSQL)}`,
      )
    ).rowCount;
  }
  async reorder(ctx: DbWriteCtx, ids: readonly string[]) {
    await ctx.db.queryRun(sql`UPDATE retention_rules r SET position=o.position
  FROM (SELECT id::uuid,
      coalesce(array_position(${[...ids]}::text[],id::text),${ids.length}::int+row_number() OVER (ORDER BY position,id)::int)-1 AS position
    FROM retention_rules) o
  WHERE r.id=o.id`);
  }
  async restart(ctx: DbWriteCtx) {
    await ctx.db.queryRun(sql`UPDATE retention_rules SET swept_until=NULL`);
  }
  async advance(ctx: DbWriteCtx, id: string, previous: Date | null, to: Date) {
    await ctx.db.queryRun(
      sql`UPDATE retention_rules SET swept_until=${to} WHERE id=${id} AND swept_until IS NOT DISTINCT FROM ${previous}::timestamptz`,
    );
  }
  async takeSweep(ctx: DbWriteCtx) {
    const row = await ctx.db.queryGet<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${sweepLock}) AS ok`,
    );
    return row?.ok ?? false;
  }
}
