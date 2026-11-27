import {
  coreFields,
  describeField,
  type FieldInfo,
  type FieldMeta,
} from "../../../../shared/console";
import { type Comp, defineSpecs, type SpecsOf } from "../common";

/**
 * What is known about one field: what its sender said and what people set.
 * People's words win; a sender never overwrites them.
 */
export interface FieldNote {
  key: string;
  sender: FieldMeta;
  person: FieldMeta;
}
/** A change to a note: only the parts given are written. */
export type FieldNoteChange = { key: string } & (
  | { sender: FieldMeta; person?: undefined }
  | { person: FieldMeta; sender?: undefined }
);

export namespace FieldNote {
  export type SortKey = "key";
  const _specs = defineSpecs({
    ByKeys: (keys: readonly string[]) => ({ keys }),
  });
  export const ByKeys = _specs.ByKeys;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /** The dictionary: every stored note and every core field, described. */
  export function dictionary(notes: FieldNote[]): FieldInfo[] {
    const byKey = new Map(notes.map((n) => [n.key, n]));
    for (const key of Object.keys(coreFields))
      if (!byKey.has(key)) byKey.set(key, { key, sender: {}, person: {} });
    return [...byKey.values()]
      .map((n) => describeField(n.key, n.sender, n.person))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** Sender meta worth writing: what differs from what is stored. */
  export function offered(
    stored: FieldNote[],
    offers: { key: string; sender: FieldMeta }[],
  ): FieldNoteChange[] {
    const byKey = new Map(stored.map((n) => [n.key, n.sender]));
    const latest = new Map(offers.map((o) => [o.key, o.sender]));
    return [...latest].flatMap(([key, sender]) => {
      const merged = { ...byKey.get(key), ...sender };
      return sameMeta(merged, byKey.get(key)) ? [] : [{ key, sender: merged }];
    });
  }

  /** A person's edit: null removes a part, so the sender's shows again. */
  export function edited(
    stored: FieldNote | undefined,
    key: string,
    patch: { [K in keyof FieldMeta]?: FieldMeta[K] | null },
  ): FieldNoteChange {
    const person: Record<string, unknown> = { ...stored?.person };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (v === null || v === "") delete person[k];
      else person[k] = v;
    }
    return { key, person: person as FieldMeta };
  }
}

function sameMeta(a: FieldMeta | undefined, b: FieldMeta | undefined) {
  const ka = Object.entries(a ?? {}).filter(([, v]) => v !== undefined);
  const kb = Object.entries(b ?? {}).filter(([, v]) => v !== undefined);
  return (
    ka.length === kb.length &&
    ka.every(([k, v]) => (b as Record<string, unknown>)[k] === v)
  );
}
