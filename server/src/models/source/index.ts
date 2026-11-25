import { type Comp, defineSpecs, type SpecsOf } from "../common";

/** A registered service and when it last delivered anything. */
export interface Source {
  id: string;
  lastReceived: Date | null;
}

export namespace Source {
  export type SortKey = "id";
  const _specs = defineSpecs({
    ById: (id: string) => ({ id }),
  });
  export const ById = _specs.ById;
  export type Spec = Comp<SpecsOf<typeof _specs>>;
}
