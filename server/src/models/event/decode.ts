import type { FieldMeta } from "../../../../shared/console";
import type { Envelope } from "../batch/schema";
import { Resource } from "../resource";

// Turns one delivered batch into the rows it contributes. Pure: the same
// batch always yields the same rows in the same order, so a row's ordinal
// finds it again; rows added later come after the ones decoded before.

/** A batch as stored; its payload is null once it has been dropped. */
export type Stored = Omit<Envelope, "payload"> & {
  payload: Envelope["payload"] | null;
};

type Obj = Record<string, unknown>;
function obj(x: unknown): Obj {
  return x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Obj)
    : {};
}
function rows(x: unknown): Obj[] {
  return Array.isArray(x) ? x.map(obj) : [];
}
function str(x: unknown) {
  return String(x ?? "").replaceAll("\u0000", "�");
}
function finite(x: unknown) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function instant(ns: unknown, fallback: string) {
  const ms = Number(ns) / 1e6;
  return ms > 0 && ms < 8.64e15 ? new Date(ms).toISOString() : fallback;
}
function identifier(raw: unknown, bytes: number) {
  const s = str(raw);
  if (new RegExp(`^[0-9a-f]{${bytes * 2}}$`, "i").test(s))
    return s.toLowerCase();
  const b = Buffer.from(s, "base64");
  return b.length === bytes ? b.toString("hex") : "";
}
function anyValue(x: unknown): unknown {
  const v = obj(x);
  if (v.kvlistValue) return attrs(obj(v.kvlistValue).values);
  if (v.arrayValue) {
    const a = obj(v.arrayValue).values;
    return Array.isArray(a) ? a.map(anyValue) : [];
  }
  return Object.values(v)[0] ?? "";
}
function attrs(x: unknown): Obj {
  return Object.fromEntries(
    rows(x).map((a) => [str(a.key), anyValue(a.value)]),
  );
}
function body(x: unknown) {
  return typeof x === "string" ? str(x) : str(JSON.stringify(x));
}
/** OTLP span kinds, as the `span.kind` attribute names them. */
const spanKinds: Record<string, string> = {
  1: "internal",
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
  SPAN_KIND_INTERNAL: "internal",
  SPAN_KIND_SERVER: "server",
  SPAN_KIND_CLIENT: "client",
  SPAN_KIND_PRODUCER: "producer",
  SPAN_KIND_CONSUMER: "consumer",
};
/** What OTLP says about a span outside its attributes, by convention's names. */
function spanContext(scope: Obj, span: Obj): Obj {
  const extra: Obj = {
    "otel.scope.name": str(scope.name),
    "otel.scope.version": str(scope.version),
    "span.kind": spanKinds[str(span.kind)] ?? "",
    "otel.status_description": str(obj(span.status).message),
  };
  return Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== ""));
}
function base(b: Stored) {
  return {
    at: b.time,
    kind: "log",
    name: "",
    body: "",
    trace: "",
    span: "",
    parent: "",
    value: null as number | null,
    unit: "",
    failed: false,
    entry: false,
    attrs: {} as Obj,
    /** Where the row came from; kept apart from `attrs` and stored once. */
    resource: null as Resource | null,
  };
}
/**
 * Each row with `raw`, the part of the payload it was decoded from (with the
 * resource and scope it sits under), which is not stored.
 */
export function* decode(b: Stored) {
  const p = obj(b.payload),
    seed = base(b);
  if (b.signal === "logs") {
    for (const e of rows(p.bufferedEvents)) {
      if (
        typeof e.name !== "string" ||
        !e.name ||
        typeof e.count !== "number" ||
        !Number.isSafeInteger(e.count) ||
        e.count < 1 ||
        typeof e.at !== "string" ||
        !Number.isFinite(Date.parse(e.at))
      )
        continue;
      yield {
        ...seed,
        at: e.at,
        kind: "event",
        name: e.name,
        value: e.count,
        unit: "件",
        attrs: { ...obj(e.attrs), "event.name": e.name },
        raw: e as unknown,
      };
    }
  }
  if (b.signal === "stdout") {
    for (const entry of Array.isArray(b.payload) ? b.payload : []) {
      // Batched lines carry their own time; a bare line has only the batch's.
      const read = typeof entry === "string" ? seed.at : entry.at;
      const line = str(typeof entry === "string" ? entry : entry.line);
      const match = line.match(/\btrace_?id[=:"]+\s*"?([0-9a-f]{32})\b/i);
      const cri = line.match(/^(\S+) (stdout|stderr) [FP] (.*)$/s);
      const stamp = cri ? Date.parse(cri[1]) : Date.parse(read);
      yield {
        ...seed,
        at: Number.isFinite(stamp) ? new Date(stamp).toISOString() : seed.at,
        body: cri?.[3] ?? line,
        name: cri?.[2] ?? "",
        trace: match?.[1].toLowerCase() ?? "",
        raw: entry as unknown,
      };
    }
    return;
  }
  if (b.signal === "resources") {
    // A batch holds a list of samples, each with its time; older agents sent
    // one sample per batch, timed by the batch.
    const samples = Array.isArray(p.samples) ? rows(p.samples) : [p];
    for (const sample of samples) {
      const stamp = Date.parse(str(sample.at));
      const at = Number.isFinite(stamp)
        ? new Date(stamp).toISOString()
        : seed.at;
      for (const [key, name, unit] of [
        ["cpuUsageUsec", "cpu.usage", "µs"],
        ["memoryBytes", "memory.current", "B"],
      ]) {
        const value = finite(sample[key]);
        if (value !== null)
          yield {
            ...seed,
            at,
            kind: "metric",
            name,
            value,
            unit,
            raw: sample as unknown,
          };
      }
    }
    return;
  }
  const groups =
    b.signal === "traces"
      ? p.resourceSpans
      : b.signal === "logs"
        ? p.resourceLogs
        : p.resourceMetrics;
  // Span events come after every span, so the spans keep the ordinals they
  // had before events were decoded.
  const events: (ReturnType<typeof base> & { raw: unknown })[] = [];
  for (const r of rows(groups)) {
    const resource = Resource.of(attrs(obj(r.resource).attributes));
    for (const s of rows(r.scopeSpans ?? r.scopeLogs ?? r.scopeMetrics)) {
      const scope = obj(s.scope);
      const under = { resource: r.resource, scope: s.scope };
      for (const a of rows(s.spans)) {
        const tags = attrs(a.attributes),
          start = finite(a.startTimeUnixNano),
          end = finite(a.endTimeUnixNano);
        const status = Number(
          tags["http.response.status_code"] ?? tags["http.status_code"],
        );
        const at = instant(a.startTimeUnixNano, b.time),
          trace = identifier(a.traceId, 16),
          span = identifier(a.spanId, 8);
        for (const ev of rows(a.events)) {
          const tags = attrs(ev.attributes),
            name = str(ev.name);
          events.push({
            ...seed,
            at: instant(ev.timeUnixNano, at),
            name,
            body: str(tags["exception.message"] ?? name),
            trace,
            span,
            failed: name === "exception",
            attrs: tags,
            resource,
            raw: { ...under, span: a, event: ev } as unknown,
          });
        }
        yield {
          ...seed,
          kind: "span",
          at,
          name: str(tags["http.route"] ?? a.name),
          body: str(a.name),
          trace,
          span,
          parent: identifier(a.parentSpanId, 8),
          entry: a.kind === "SPAN_KIND_SERVER" || a.kind === 2,
          failed:
            status >= 500 ||
            obj(a.status).code === "STATUS_CODE_ERROR" ||
            obj(a.status).code === 2,
          value:
            start !== null && end !== null && end >= start
              ? (end - start) / 1e6
              : null,
          unit: "ms",
          attrs: { ...spanContext(scope, a), ...tags },
          resource,
          raw: { ...under, span: a } as unknown,
        };
      }
      for (const l of rows(s.logRecords))
        yield {
          ...seed,
          at: instant(l.timeUnixNano ?? l.observedTimeUnixNano, b.time),
          name: str(l.severityText),
          body: body(anyValue(l.body)),
          trace: identifier(l.traceId, 16),
          span: identifier(l.spanId, 8),
          attrs: attrs(l.attributes),
          resource,
          raw: { ...under, logRecord: l } as unknown,
        };
      for (const m of rows(s.metrics)) {
        for (const type of [
          "gauge",
          "sum",
          "histogram",
          "exponentialHistogram",
          "summary",
        ]) {
          const metric = obj(m[type]);
          const { dataPoints: _, ...about } = metric;
          for (const pt of rows(metric.dataPoints)) {
            const raw = {
              ...under,
              metric: { ...m, [type]: about },
              dataPoint: pt,
            } as unknown;
            const point = {
              ...seed,
              kind: "metric",
              at: instant(pt.timeUnixNano, b.time),
              name: str(m.name),
              unit: str(m.unit),
              attrs: {
                ...attrs(pt.attributes),
                type,
                temporality: metric.aggregationTemporality,
                monotonic: metric.isMonotonic,
                startTimeUnixNano: pt.startTimeUnixNano,
              },
              resource,
              raw,
            };
            if (pt.asDouble !== undefined || pt.asInt !== undefined) {
              yield { ...point, value: finite(pt.asDouble ?? pt.asInt) };
              continue;
            }
            for (const field of ["count", "sum", "min", "max"]) {
              if (pt[field] !== undefined)
                yield {
                  ...point,
                  name: `${point.name}.${field}`,
                  unit: field === "count" ? "" : point.unit,
                  value: finite(pt[field]),
                };
            }
            for (const q of rows(pt.quantileValues))
              yield {
                ...point,
                name: `${point.name}.p${Number(q.quantile) * 100}`,
                value: finite(q.value),
              };
          }
        }
      }
    }
  }
  yield* events;
}

/** The part of the payload the batch's `ordinal`-th row came from. */
export function rawOf(b: Stored, ordinal: number): unknown {
  let i = 0;
  for (const row of decode(b)) if (i++ === ordinal) return row.raw;
  return undefined;
}

/**
 * The yuniview agent's resource samples, as their sender describes them:
 * counters are read as rates, and CPU time per second as a share of a core.
 */
const resourceFields: [string, FieldMeta][] = [
  [
    "metric:memory.current",
    {
      label: "メモリ使用量",
      description: "コンテナが使っているメモリ（cgroup の memory.current）",
      unit: "B",
      display: "MiB",
      kind: "gauge",
      agg: "avg",
    },
  ],
  [
    "metric:cpu.usage",
    {
      label: "CPU 時間",
      description:
        "コンテナが使った CPU 時間の累計（cgroup の cpu.stat usage_usec）。増加率は 1 コアを 100% とした使用率",
      unit: "µs",
      display: "%",
      kind: "counter",
      agg: "rate",
    },
  ],
];

/** What a batch's sender says about the fields its rows carry. */
export function* fieldsOf(b: Stored): Generator<[string, FieldMeta]> {
  if (b.signal === "resources") {
    yield* resourceFields;
    return;
  }
  if (b.signal !== "metrics") return;
  const p = obj(b.payload);
  for (const r of rows(p.resourceMetrics))
    for (const s of rows(r.scopeMetrics))
      for (const m of rows(s.metrics)) {
        const name = str(m.name);
        if (!name) continue;
        const description = str(m.description) || undefined;
        const unit = str(m.unit) || undefined;
        const sum = obj(m.sum);
        const cumulative = (t: unknown) =>
          t === 2 || t === "AGGREGATION_TEMPORALITY_CUMULATIVE";
        if (m.gauge !== undefined)
          yield [`metric:${name}`, { description, unit, kind: "gauge" }];
        else if (m.sum !== undefined)
          yield [
            `metric:${name}`,
            {
              description,
              unit,
              kind:
                sum.isMonotonic && cumulative(sum.aggregationTemporality)
                  ? "counter"
                  : "gauge",
            },
          ];
        else
          for (const type of ["histogram", "exponentialHistogram", "summary"]) {
            if (m[type] === undefined) continue;
            const counting = cumulative(obj(m[type]).aggregationTemporality)
              ? "counter"
              : "gauge";
            yield [`metric:${name}.count`, { description, kind: counting }];
            yield [`metric:${name}.sum`, { description, unit, kind: counting }];
          }
      }
}
