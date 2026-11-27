import type { RetentionRecord, RetentionRule } from "../../models/retention";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export interface IRetentionRuleRepository {
  /** Every rule, in the order rules are read. */
  list(ctx: DbReadCtx): Promise<RetentionRecord[]>;
  /** Saves a rule, keeping its place; a new rule goes last. */
  upsert(ctx: DbWriteCtx, rule: RetentionRule): Promise<void>;
  delete(ctx: DbWriteCtx, spec: RetentionRule.Spec): Promise<number>;
  /** Puts the rules in this order. Rules not listed keep their places after. */
  reorder(ctx: DbWriteCtx, ids: readonly string[]): Promise<void>;
  /** Sweeps every rule again from the oldest row. */
  restart(ctx: DbWriteCtx): Promise<void>;
  /**
   * Records how far a rule's sweep reached, unless the rules changed since
   * it read `previous`.
   */
  advance(
    ctx: DbWriteCtx,
    id: string,
    previous: Date | null,
    to: Date,
  ): Promise<void>;
  /**
   * Takes the sweep for this transaction, or reports that another worker
   * holds it. Servers would otherwise delete the same rows side by side.
   */
  takeSweep(ctx: DbWriteCtx): Promise<boolean>;
}
