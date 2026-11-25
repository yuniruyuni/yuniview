import { type Comp, defineSpecs, type SpecsOf } from "../common";
import type { DailySet } from "../daily-set";
import type { Event } from "../event";
import { decode } from "../event/decode";
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
  events: Event[];
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
  });
  export const ByKeys = _specs.ByKeys;
  export const Pending = _specs.Pending;
  export const OldestBefore = _specs.OldestBefore;
  export const Slot = _specs.Slot;
  export const Revision = _specs.Revision;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  export function received(envelope: Envelope, at: Date): Batch {
    return { ...envelope, receivedAt: at, indexed: false, events: [] };
  }

  /** The batch with every row it contributes, ready to be stored together. */
  export function index(batch: Batch): Batch {
    const s = batch.source;
    const events = Array.from(decode(batch), (row, ordinal) => ({
      ...row,
      id: `${s.service}/${batch.id}/${ordinal}`,
      batchId: batch.id,
      ordinal,
      source: s.service,
      instance: s.instance,
      workload: s.workload,
      slot: s.slot ?? "",
      revision: s.revision ?? "",
    }));
    return { ...batch, indexed: true, events };
  }

  export function key(batch: Batch): Key {
    return { source: batch.source.service, id: batch.id };
  }
}

/** What one delivery asks to store, once its envelope is accepted. */
export type Delivery =
  | { type: "batch"; envelope: Envelope }
  | { type: "member"; member: DailySet };

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
              }))
              .safeParse(e.payload)
          : dailySet.safeParse(e.payload);
      if (!result.success) return null;
      const { day, field, digest } = result.data;
      return {
        type: "member",
        member: { day, field, digest, source: e.source.service },
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
