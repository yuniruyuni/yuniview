import type {
  Backtest,
  Monitor as Definition,
  Point,
  Transition,
} from "../../../../shared/console";
import { type Comp, defineSpecs, type SpecsOf } from "../common";
import { generateId } from "../common/id";

export type Monitor = Definition;

export type MonitorState = "pending" | "ok" | "alert" | "no_data";

/** A monitor definition and the outcome of its latest evaluation. */
export interface MonitorRecord {
  definition: Monitor;
  state: string;
  /** End of the last evaluated window; null schedules a fresh evaluation. */
  evaluated: Date | null;
  value: number | null;
  /** Edit version of the stored definition. Ignored when writing. */
  version: string;
}

export namespace Monitor {
  export type SortKey = "title" | "id";
  const _specs = defineSpecs({
    ById: (id: string) => ({ id }),
    /** Not yet evaluated for the window ending at `end`. */
    Due: (end: Date) => ({ end }),
  });
  export const ById = _specs.ById;
  export const Due = _specs.Due;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  /**
   * How long after a minute its rows may still be arriving. Agents hold
   * their deliveries for up to a minute to send them together, and SDKs
   * hold spans a few seconds before that.
   */
  export const arrivalMs = 75000;

  /**
   * The minute boundary the latest complete window ends at: the latest one
   * whose rows have all arrived. Judging a minute still in flight would see
   * too few requests, or none, and raise a false alert or no-data.
   */
  export function windowEnd(now: Date) {
    return new Date(Math.floor((now.getTime() - arrivalMs) / 60000) * 60000);
  }

  /** Days a backtest replays. */
  export const backtestDays = 7;

  /**
   * How a monitor would have judged each of its windows over the past days.
   * Points arrive bucketed by the monitor's window.
   */
  export function backtest(m: Monitor, end: Date, points: Point[]): Backtest {
    const step = m.panel.minutes * 60000;
    const windows = Math.floor((backtestDays * 1440) / m.panel.minutes);
    const byBucket = new Map<number, Point[]>();
    for (const p of points) {
      const at = Date.parse(p.bucket);
      byBucket.set(at, [...(byBucket.get(at) ?? []), p]);
    }
    const starts = [...byBucket.keys()].sort((a, b) => a - b);
    const result: Backtest = {
      days: backtestDays,
      windows,
      alert: 0,
      ok: 0,
      noData: 0,
    };
    const first = starts[0] ?? end.getTime() - windows * step;
    for (let i = 0; i < windows; i++) {
      const at = first + i * step;
      if (at >= end.getTime()) break;
      const state = verdict(m, byBucket.get(at) ?? []).state;
      if (state === "alert") result.alert++;
      else if (state === "ok") result.ok++;
      else result.noData++;
    }
    return result;
  }

  export function verdict(m: Monitor, points: Point[]) {
    const eligible = points.filter((p) => p.samples >= m.minimum);
    if (!eligible.length)
      return {
        state: (m.missing === "alert" ? "alert" : "no_data") as MonitorState,
        value: null,
      };
    const value = eligible.reduce(
      (v, p) =>
        m.operator === "above" ? Math.max(v, p.value) : Math.min(v, p.value),
      eligible[0].value,
    );
    const breached =
      m.operator === "above" ? value > m.threshold : value < m.threshold;
    return { state: (breached ? "alert" : "ok") as MonitorState, value };
  }

  /**
   * Stores a new definition. The state carries over; a changed definition is
   * evaluated again at the next tick.
   */
  export function revise(
    stored: MonitorRecord | null,
    definition: Monitor,
  ): MonitorRecord {
    if (!stored)
      return {
        definition,
        state: "pending",
        evaluated: null,
        value: null,
        version: "",
      };
    return {
      ...stored,
      definition,
      evaluated: sameJson(stored.definition, definition)
        ? stored.evaluated
        : null,
    };
  }
}

/** Deep equality of JSON values regardless of key order, as jsonb compares. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  const ka = Object.keys(a).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  );
  const kb = Object.keys(b).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  );
  return (
    ka.length === kb.length &&
    ka.every((k) =>
      sameJson(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  );
}

/** A state change of a monitor and the delivery of its notification. */
export interface MonitorEvent extends Transition {
  monitorId: string;
  createdAt: Date;
  delivery: "pending" | "sent" | "off";
  retryAt: Date;
}

export namespace MonitorEvent {
  export type SortKey = "createdAt" | "id";
  const _specs = defineSpecs({
    /**
     * Pending notifications due by `now` whose monitor has no older pending
     * one, so each monitor's notifications arrive in order.
     */
    Deliverable: (now: Date) => ({ now }),
    ByIds: (...ids: string[]) => ({ ids }),
  });
  export const Deliverable = _specs.Deliverable;
  export const ByIds = _specs.ByIds;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  export const retryDelayMs = 60000;
  export const batchSize = 5;

  export function transition(
    m: Monitor,
    state: string,
    at: Date,
    value: number | null,
    now: Date,
  ): MonitorEvent {
    return {
      id: generateId(),
      monitorId: m.id,
      title: m.title,
      state,
      at: at as unknown as string,
      value,
      createdAt: now,
      delivery: m.notify ? "pending" : "off",
      retryAt: now,
    };
  }

  /** What a webhook receives. The ID doubles as the idempotency key. */
  export function notification(e: MonitorEvent) {
    return {
      id: e.id,
      title: e.title,
      state: e.state,
      at: e.at,
      value: e.value,
    };
  }
}
