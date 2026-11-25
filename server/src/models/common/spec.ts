// Specification pattern. Leaf specs are plain data tagged by `type`; the
// composites below combine them without the repository having to know
// anything beyond how to turn one leaf into SQL.

export type Leaf = { readonly type: string };

export type Node<T extends Leaf> =
  | T
  | { readonly type: "And"; readonly items: readonly Comp<T>[] }
  | { readonly type: "Or"; readonly items: readonly Comp<T>[] }
  | { readonly type: "Not"; readonly item: Comp<T> }
  | { readonly type: "All" };

export interface Combinators<T extends Leaf> {
  and(...others: Comp<T>[]): Comp<T>;
  or(...others: Comp<T>[]): Comp<T>;
  not(): Comp<T>;
}

export type Comp<T extends Leaf> = Node<T> & Combinators<T>;

function wrap<T extends Leaf>(node: Node<T>): Comp<T> {
  return Object.assign(Object.create(methods), node) as Comp<T>;
}
const methods = {
  and<T extends Leaf>(this: Comp<T>, ...others: Comp<T>[]) {
    return and(this, ...others);
  },
  or<T extends Leaf>(this: Comp<T>, ...others: Comp<T>[]) {
    return or(this, ...others);
  },
  not<T extends Leaf>(this: Comp<T>) {
    return not(this);
  },
};

export function and<T extends Leaf>(...items: Comp<T>[]): Comp<T> {
  const flat = items.flatMap((i) =>
    i.type === "And" ? (i as { items: readonly Comp<T>[] }).items : [i],
  );
  const kept = flat.filter((i) => i.type !== "All");
  if (kept.length === 0) return all<T>();
  if (kept.length === 1) return kept[0];
  return wrap<T>({ type: "And", items: kept });
}
export function or<T extends Leaf>(...items: Comp<T>[]): Comp<T> {
  if (items.length === 1) return items[0];
  return wrap<T>({ type: "Or", items });
}
export function not<T extends Leaf>(item: Comp<T>): Comp<T> {
  return wrap<T>({ type: "Not", item });
}
/** Matches every row. The identity of `and`. */
export function all<T extends Leaf>(): Comp<T> {
  return wrap<T>({ type: "All" });
}

type Factories = Record<string, (...args: never[]) => object>;
type LeafOf<F extends Factories, K extends keyof F & string> = {
  readonly type: K;
} & ReturnType<F[K]>;
export type SpecsOf<F extends Factories> = {
  [K in keyof F & string]: LeafOf<F, K>;
}[keyof F & string];

export function defineSpecs<F extends Factories>(
  factories: F,
): {
  [K in keyof F & string]: (
    ...args: Parameters<F[K]>
  ) => Comp<SpecsOf<F>> & LeafOf<F, K>;
} {
  const out: Record<string, unknown> = {};
  for (const [type, make] of Object.entries(factories))
    out[type] = (...args: never[]) =>
      wrap({ ...(make(...args) as object), type } as Leaf);
  // biome-ignore lint/suspicious/noExplicitAny: mapped above
  return out as any;
}
