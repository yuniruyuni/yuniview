import type { Batch } from "./telemetry";

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
function base(b: Batch) {
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
  };
}
export function* events(b: Batch) {
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
      };
    }
  }
  if (b.signal === "stdout") {
    for (const text of Array.isArray(b.payload) ? b.payload : []) {
      const line = str(text);
      const match = line.match(/\btrace_?id[=:"]+\s*"?([0-9a-f]{32})\b/i);
      const cri = line.match(/^(\S+) (stdout|stderr) [FP] (.*)$/s);
      const stamp = cri ? Date.parse(cri[1]) : NaN;
      yield {
        ...seed,
        at: Number.isFinite(stamp) ? new Date(stamp).toISOString() : seed.at,
        body: cri?.[3] ?? line,
        name: cri?.[2] ?? "",
        trace: match?.[1].toLowerCase() ?? "",
      };
    }
    return;
  }
  if (b.signal === "resources") {
    for (const [key, name, unit] of [
      ["cpuUsageUsec", "cpu.usage", "µs"],
      ["memoryBytes", "memory.current", "B"],
    ]) {
      const value = finite(p[key]);
      if (value !== null) yield { ...seed, kind: "metric", name, value, unit };
    }
    return;
  }
  const groups =
    b.signal === "traces"
      ? p.resourceSpans
      : b.signal === "logs"
        ? p.resourceLogs
        : p.resourceMetrics;
  for (const r of rows(groups)) {
    const resource = attrs(obj(r.resource).attributes);
    for (const s of rows(r.scopeSpans ?? r.scopeLogs ?? r.scopeMetrics)) {
      for (const a of rows(s.spans)) {
        const tags = attrs(a.attributes),
          start = finite(a.startTimeUnixNano),
          end = finite(a.endTimeUnixNano);
        const status = Number(
          tags["http.response.status_code"] ?? tags["http.status_code"],
        );
        yield {
          ...seed,
          kind: "span",
          at: instant(a.startTimeUnixNano, b.time),
          name: str(tags["http.route"] ?? a.name),
          body: str(a.name),
          trace: identifier(a.traceId, 16),
          span: identifier(a.spanId, 8),
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
          attrs: { resource, ...tags },
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
          attrs: { resource, ...attrs(l.attributes) },
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
          for (const pt of rows(metric.dataPoints)) {
            const point = {
              ...seed,
              kind: "metric",
              at: instant(pt.timeUnixNano, b.time),
              name: str(m.name),
              unit: str(m.unit),
              attrs: {
                ...attrs(pt.attributes),
                resource,
                type,
                temporality: metric.aggregationTemporality,
                monotonic: metric.isMonotonic,
                startTimeUnixNano: pt.startTimeUnixNano,
              },
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
}
