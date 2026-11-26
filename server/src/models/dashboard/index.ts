import {
  type Dashboard as Definition,
  type Panel,
  upgradePanel,
} from "../../../../shared/console";
import { type Comp, defineSpecs, type SpecsOf } from "../common";

export type Dashboard = Definition;

/** A saved definition with the edit version clients must present to replace it. */
export interface Versioned<T> {
  definition: T;
  version: string;
}

export namespace Dashboard {
  export type SortKey = "title" | "id";
  const _specs = defineSpecs({
    ById: (id: string) => ({ id }),
  });
  export const ById = _specs.ById;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /** A stored definition, its panels rewritten to the current form. */
  export function stored(d: Dashboard): Dashboard {
    return { ...d, panels: d.panels.map((p) => upgradePanel(p) as Panel) };
  }
}
