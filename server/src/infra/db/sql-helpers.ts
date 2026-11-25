import type { Comp, Leaf, Node } from "../../models/common/spec";
import { type SQLFragment, sql } from "./sql";

/** Expand AND/OR/NOT/All recursively; `leaf` converts one entity spec. */
export function compToSQL<T extends Leaf>(
  spec: Comp<T> | Node<T>,
  leaf: (spec: T) => SQLFragment,
): SQLFragment {
  const node = spec as Node<T>;
  switch (node.type) {
    case "All":
      return sql`true`;
    case "And":
      return sql`(${sql.join(
        (node as { items: readonly Comp<T>[] }).items.map((i) =>
          compToSQL(i, leaf),
        ),
        " AND ",
      )})`;
    case "Or":
      return sql`(${sql.join(
        (node as { items: readonly Comp<T>[] }).items.map((i) =>
          compToSQL(i, leaf),
        ),
        " OR ",
      )})`;
    case "Not":
      return sql`NOT (${compToSQL((node as { item: Comp<T> }).item, leaf)})`;
    default:
      return leaf(node as T);
  }
}

/** ORDER BY for `keys`, mapping each through `column`. */
export function orderBy<K extends string>(
  keys: readonly K[],
  order: "asc" | "desc",
  column: (key: K) => SQLFragment,
): SQLFragment {
  const dir = sql.raw(order === "asc" ? "ASC" : "DESC");
  return sql.join(
    keys.map((k) => sql`${column(k)} ${dir}`),
    ", ",
  );
}

/** Tuple comparison continuing after the previous page's last row. */
export function afterCursor<K extends string>(
  keys: readonly K[],
  order: "asc" | "desc",
  after: Record<K, string> | undefined,
  column: (key: K) => SQLFragment,
  cast: (key: K) => SQLFragment,
): SQLFragment {
  if (!after) return sql`true`;
  const cols = sql.join(keys.map(column), ",");
  const vals = sql.join(
    keys.map((k) => sql`${after[k]}::${cast(k)}`),
    ",",
  );
  return order === "asc"
    ? sql`(${cols}) > (${vals})`
    : sql`(${cols}) < (${vals})`;
}

export function lockClause(lock: "update" | "skip_locked" | undefined) {
  return lock === "update"
    ? sql` FOR UPDATE`
    : lock === "skip_locked"
      ? sql` FOR UPDATE SKIP LOCKED`
      : sql``;
}
