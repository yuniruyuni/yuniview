import type { FieldMeta } from "../../../../shared/console";
import { type Comp, defineSpecs, type SpecsOf } from "../common";
import type { DailySet } from "../daily-set";
import type { Event } from "../event";
import { decode, fieldsOf } from "../event/decode";
import type { Resource } from "../resource";
import {
  batchSchema,
  bufferedEvents,
  dailySet,
  type Envelope,
  usageMark,
} from "./schema";

export type { Envelope } from "./schema";

/**
 * A delivered batch and the rows indexed from it. Batches are immutable once
 * stored; only `indexed` changes, when its rows are written.
 */
export interface Batch extends Envelope {
  receivedAt: Date;
  indexed: boolean;
  /** Rows, each referring to its resource by digest instead of carrying it. */
  events: (Event & { resource: string | null })[];
  /** The distinct resources the rows refer to. */
  resources: Resource[];
  /** What the sender says about the fields of its rows, once indexed. */
  fields: { key: string; sender: FieldMeta }[];
}

export namespace Batch {
  export type SortKey = "receivedAt" | "source" | "id";
  export type Key = { source: string; id: string };

  const _specs = defineSpecs({
    ByKeys: (...keys: Key[]) => ({ keys }),
    /** Stored, but its rows are not indexed yet. */
    Pending: () => ({}),
    /**
     * The `count` earliest received before `at` that no other worker holds,
     * so expiry proceeds in bounded steps.
     */
    OldestBefore: (at: Date, count: number) => ({ at, count }),
    Slot: (slot: string) => ({ slot }),
    Revision: (revision: string) => ({ revision }),
    /** Indexed, with every row since deleted (by retention rules). */
    Emptied: () => ({}),
  });
  export const ByKeys = _specs.ByKeys;
  export const Pending = _specs.Pending;
  export const OldestBefore = _specs.OldestBefore;
  export const Slot = _specs.Slot;
  export const Revision = _specs.Revision;
  export const Emptied = _specs.Emptied;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  export function received(envelope: Envelope, at: Date): Batch {
    return {
      ...envelope,
      receivedAt: at,
      indexed: false,
      events: [],
      resources: [],
      fields: [],
    };
  }

  /** The batch with every row it contributes, ready to be stored together. */
  export function index(batch: Batch): Batch {
    const s = batch.source;
    const resources = new Map<string, Resource>();
    const events = Array.from(
      decode(batch),
      ({ resource, ...row }, ordinal) => {
        if (resource) resources.set(resource.digest, resource);
        return {
          ...row,
          resource: resource?.digest ?? null,
          id: `${s.service}/${batch.id}/${ordinal}`,
          batchId: batch.id,
          ordinal,
          source: s.service,
          instance: s.instance,
          workload: s.workload,
          slot: s.slot ?? "",
          revision: s.revision ?? "",
        };
      },
    );
    const fields = [...new Map(fieldsOf(batch))].map(([key, sender]) => ({
      key,
      sender: JSON.parse(JSON.stringify(sender)) as FieldMeta,
    }));
    return {
      ...batch,
      indexed: true,
      events,
      resources: [...resources.values()],
      fields,
    };
  }

  export function key(batch: Batch): Key {
    return { source: batch.source.service, id: batch.id };
  }
}

/** What one delivery asks to store, once its envelope is accepted. */
export type Delivery =
  | { type: "batch"; envelope: Envelope }
  | {
      type: "member";
      member: DailySet;
      /** What the sender says about the set. */
      field: { key: string; sender: FieldMeta } | null;
    };

/** The yuniview agent's visit marks, as their sender describes them. */
const visitSets = {
  account: {
    label: "ログイン利用者",
    description: "その日にログインして確認できたアカウント。1日1件",
  },
  browser: {
    label: "訪問ブラウザー",
    description:
      "その日に公開ページを開いた同じブラウザー。1日1件。ブラウザーのデータを消すと別の1件になる",
  },
};

export namespace Delivery {
  export function envelope(body: unknown): Envelope | null {
    const result = batchSchema.safeParse(body);
    return result.success ? result.data : null;
  }

  /** The content of an accepted envelope, or null when its payload is invalid. */
  export function of(e: Envelope): Delivery | null {
    if (e.signal === "usage" || e.signal === "daily_set") {
      const result =
        e.signal === "usage"
          ? usageMark
              .transform(({ kind, ...mark }) => ({
                ...mark,
                field: `visit.${kind}`,
                ...visitSets[kind],
              }))
              .safeParse(e.payload)
          : dailySet.safeParse(e.payload);
      if (!result.success) return null;
      const { day, field, digest, label, description } = result.data;
      const sender = JSON.parse(
        JSON.stringify({ label, description }),
      ) as FieldMeta;
      return {
        type: "member",
        member: { day, field, digest, source: e.source.service },
        field: Object.keys(sender).length
          ? { key: `set:${field}`, sender }
          : null,
      };
    }
    if (
      e.signal === "logs" &&
      "bufferedEvents" in e.payload &&
      !bufferedEvents.safeParse(e.payload.bufferedEvents).success
    )
      return null;
    return { type: "batch", envelope: e };
  }
}
