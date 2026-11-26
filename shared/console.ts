export type Identifier =
  | "source"
  | "slot"
  | "revision"
  | "workload"
  | "instance";
export type Axis = Identifier | "day";
export const axes: Record<Axis, string> = {
  source: "サービス",
  slot: "スロット",
  revision: "リビジョン",
  instance: "インスタンス",
  workload: "ワークロード",
  day: "時刻（1日・JST）",
};
export type Attribute = `attr:${string}`;
export const isAttribute = (key: string): key is Attribute =>
  key.startsWith("attr:");
export type Dimension = Axis | Attribute;
export const timeBuckets = {
  "time:1": "時刻（1秒）",
  "time:10": "時刻（10秒）",
  "time:60": "時刻（1分）",
  "time:300": "時刻（5分）",
  "time:3600": "時刻（1時間）",
  "time:86400": "時刻（1日・UTC）",
} as const;
export type TimeField = keyof typeof timeBuckets;
export const isTimeField = (key: string): key is TimeField =>
  Object.hasOwn(timeBuckets, key);
export type TimeZone = "JST" | "UTC";
export function fieldZone(pivot: Pivot | undefined, field: string): TimeZone {
  if (field === "day") return "JST";
  if (field === "time:86400") return "UTC";
  return pivot?.timeZones?.[field] ?? "JST";
}
export const isTemporalField = (key: string): key is TimeField | "day" =>
  key === "day" || isTimeField(key);
export const cpuPercent = "derived:cpu.percent";
export function metricName(name: string) {
  return name === cpuPercent
    ? "CPU 使用率 (%)"
    : name === "memory.current"
      ? "メモリ使用量"
      : name === "cpu.usage"
        ? "CPU 使用時間（累積）"
        : name;
}
export type ShelfAxis = Dimension | TimeField | "measure";
export function shelfName(key: ShelfAxis | "log") {
  if (key === "log") return "ログ";
  return key === "measure"
    ? "指標"
    : isAttribute(key)
      ? key.slice(5)
      : isTimeField(key)
        ? timeBuckets[key]
        : axes[key];
}
export type ShelfFields = ShelfAxis | ShelfAxis[];
export function shelfFields(value?: ShelfFields): ShelfAxis[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
export function pivotFields(p: Pivot) {
  return [
    ...shelfFields(p.row),
    ...shelfFields(p.column),
    ...shelfFields(p.series),
  ];
}
export type WorksheetMark =
  | "auto"
  | "table"
  | "line"
  | "bar"
  | "area"
  | "stacked_area";
export const styleChannels = {
  color: "色",
  dash: "線種",
  width: "線の太さ",
  shape: "点の形",
} as const;
export type StyleChannel = keyof typeof styleChannels;
export type StyleRule = { channel: StyleChannel; value: string; index: number };
export type Pivot = {
  timeZones?: Record<string, TimeZone>;
  styleRules?: StyleRule[];
  encoding?: Partial<Record<StyleChannel, ShelfAxis>>;
  row: ShelfFields;
  column: ShelfFields;
  series?: ShelfFields;
  mark?: WorksheetMark;
};
export interface Filter {
  source: string;
  instance: string;
  workload: string;
  slot: string;
  revision: string;
  text: string;
  minutes: number;
}
export function usesLogRecords(panel: Pick<Panel, "data">) {
  return panel.data === "log";
}
export type FilterField = Dimension | TimeField | "log";
export interface FieldCondition {
  field: FilterField;
  contains?: string;
  values?: string[];
  min?: number;
  max?: number;
}
export interface FilterOptions {
  values: string[];
  more: boolean;
  numeric: boolean;
  min: number | null;
  max: number | null;
}
export interface Panel extends Filter {
  fieldUnits?: Record<string, string>;
  styleDefaults?: Partial<Record<StyleChannel, number>>;
  fixedStyle?: Partial<Record<StyleChannel, number>>;
  conditions?: FieldCondition[];
  wide?: boolean;
  id?: string;
  title: string;
  /** The rows the panel reads. */
  data: DataKind;
  /** What is measured over those rows; the measure shelf lists them in order. */
  values: Value[];
  totalSlots?: string[];
  group: "all" | "slot_total" | Identifier | Attribute;
  display: "chart" | "value" | "table" | "pivot";
  pivot?: Pivot;
  unit?: "MiB";
}
export function chartBucketSeconds(minutes: number) {
  return Math.max(1, Math.ceil((minutes * 60) / 40));
}
export const defaultTotalSlots = ["blue", "green"];
export const slotTotalChoice: [string, string] = [
  "slot_total",
  "スロット合計（サービス別）",
];
export function changeGroup(p: Panel, group: Panel["group"]): Panel {
  if (group !== "slot_total") return { ...p, group };
  return {
    ...p,
    group,
    slot: "",
    instance: "",
    values: p.values
      .slice(0, 1)
      .map((v) => (v.agg === "sum" ? { ...v, agg: "avg" } : v)),
  };
}
export interface Monitor {
  id: string;
  title: string;
  panel: Panel;
  threshold: number;
  operator: "above" | "below";
  minimum: number;
  missing: "no_data" | "alert";
  notify: boolean;
}
export interface Dashboard {
  id: string;
  title: string;
  panels: Panel[];
}
export interface Point {
  column?: string;
  facet?: string;
  facetPath?: string[];
  rowPath?: string[];
  columnPath?: string[];
  metricUnit?: string;
  bucket: string;
  series: string;
  value: number;
  samples: number;
}
export interface EventRow {
  id: string;
  batchId: string;
  ordinal: number;
  at: string;
  source: string;
  instance: string;
  workload: string;
  slot: string;
  revision: string;
  kind: string;
  name: string;
  body: string;
  trace: string;
  span: string;
  parent: string;
  value: number | null;
  unit: string;
  failed: boolean;
  entry: boolean;
  attrs: Record<string, unknown>;
}
export interface Overview {
  services: {
    source: string;
    last: string | null;
    requests: number;
    errors: number;
    latency: number | null;
  }[];
  metrics: string[];
  metricUnits?: Record<string, string>;
  dailyFields: string[];
  slots: string[];
  revisions: string[];
}
export interface RouteRow {
  source: string;
  name: string;
  requests: number;
  errors: number;
  p95: number | null;
  trace: string;
}
export interface MonitorRow {
  definition: Monitor;
  state: string;
  evaluated: string | null;
  value: number | null;
}
export interface Transition {
  id: string;
  title: string;
  state: string;
  at: string;
  value: number | null;
  delivery: string;
}
export const defaults: Filter = {
  source: "",
  instance: "",
  workload: "",
  slot: "",
  revision: "",
  text: "",
  minutes: 60,
};
export const blankPanel: Panel = {
  ...defaults,
  title: "リクエスト数",
  data: "request",
  values: [{ agg: "count", of: [] }],
  group: "source",
  display: "chart",
};

/** The rows a panel reads. */
export type DataKind =
  | "request"
  | "span"
  | "log"
  | "event"
  | "metric"
  | "daily";
export const dataKinds: Record<DataKind, string> = {
  request: "リクエスト",
  span: "スパン",
  log: "ログ",
  event: "イベント",
  metric: "メトリクス",
  daily: "日次集合",
};
/** How a value is computed from the fields it is placed on. */
export type Agg =
  | "count"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "p50"
  | "p95"
  | "p99"
  | "distinct"
  | "ratio"
  | "daily";
export const aggNames: Record<Agg, string> = {
  count: "件数",
  sum: "合計",
  avg: "平均",
  min: "最小",
  max: "最大",
  p50: "p50",
  p95: "p95",
  p99: "p99",
  distinct: "種類数",
  ratio: "割合",
  daily: "日ごとの種類数",
};
/**
 * A field a value can be computed from: the row's own number (`value`: a
 * span's duration or an event's count), whether it failed, a metric, a
 * daily set, or any dimension for distinct counts.
 */
export type ValueField =
  | "value"
  | "failed"
  | `metric:${string}`
  | `set:${string}`
  | Dimension;
export interface Value {
  agg: Agg;
  /** Empty for a row count; several dimensions count distinct combinations. */
  of: ValueField[];
  mark?: WorksheetMark;
}
export type FieldType = "number" | "boolean" | "set" | "dimension";
export function fieldType(field: ValueField): FieldType {
  if (field === "value" || field.startsWith("metric:")) return "number";
  if (field === "failed") return "boolean";
  if (field.startsWith("set:")) return "set";
  return "dimension";
}
const numberAggs: Agg[] = ["avg", "sum", "min", "max", "p50", "p95", "p99"];
/** The ways a value over `of` can be computed. */
export function aggsFor(data: DataKind, of: readonly ValueField[]): Agg[] {
  if (of.length === 0)
    return data === "metric" || data === "daily" ? [] : ["count"];
  if (of.length > 1)
    return of.every((f) => fieldType(f) === "dimension") ? ["distinct"] : [];
  switch (fieldType(of[0])) {
    case "number":
      return numberAggs;
    case "boolean":
      return ["ratio"];
    case "set":
      return ["daily"];
    case "dimension":
      return data === "daily" || data === "metric" ? [] : ["distinct"];
  }
}
/** The aggregation a field gets when first placed as a value. */
export function defaultAgg(data: DataKind, of: readonly ValueField[]): Agg {
  if (data === "request" && of[0] === "value") return "p95";
  return aggsFor(data, of)[0] ?? "count";
}
/** The numeric and flag fields a kind of data carries. */
export function measurableFields(
  data: DataKind,
  meta: { metrics: string[]; dailyFields: string[] },
): ValueField[] {
  switch (data) {
    case "request":
    case "span":
      return ["value", "failed"];
    case "event":
      return ["value"];
    case "log":
      return [];
    case "metric":
      return [
        "metric:memory.current",
        `metric:${cpuPercent}`,
        ...meta.metrics
          .filter((m) => m !== "memory.current")
          .map((m): ValueField => `metric:${m}`),
      ];
    case "daily":
      return meta.dailyFields.map((f): ValueField => `set:${f}`);
  }
}
export function metricOf(field: ValueField | undefined) {
  return field?.startsWith("metric:") ? field.slice(7) : undefined;
}
export function setOf(field: ValueField | undefined) {
  return field?.startsWith("set:") ? field.slice(4) : undefined;
}
export function valueFieldName(data: DataKind, field: ValueField) {
  if (field === "value") return data === "event" ? "実行回数" : "所要時間";
  if (field === "failed") return "失敗";
  const metric = metricOf(field);
  if (metric !== undefined) return metricName(metric);
  const set = setOf(field);
  if (set !== undefined) return set;
  return shelfName(field as Dimension);
}
/** The label cells carry for a value on the measure shelf. */
export function valueKey(v: Pick<Value, "agg" | "of">) {
  return `${v.agg}(${v.of.join(",")})`;
}
const countNames: Partial<Record<DataKind, string>> = {
  request: "リクエスト数",
  span: "スパン数",
  log: "ログ件数",
  event: "イベント件数",
};
export function valueName(data: DataKind, v: Pick<Value, "agg" | "of">) {
  if (v.agg === "count") return countNames[data] ?? "件数";
  const fields = v.of.map((f) => valueFieldName(data, f)).join(" × ");
  if (v.agg === "avg" && metricOf(v.of[0]) !== undefined) return fields;
  if (v.agg === "ratio") return fields + "率 (%)";
  if (v.agg === "distinct" && v.of.length > 1) return fields + " の組の種類数";
  return fields + " · " + aggNames[v.agg];
}
/** The key display units of a value are stored under. */
export function unitKey(v: Pick<Value, "agg" | "of">) {
  const metric = v.of.length === 1 ? metricOf(v.of[0]) : undefined;
  return metric !== undefined ? "metric/" + metric : valueKey(v);
}
/** Whether a value counts things, so axes use whole numbers. */
export function countsWhole(data: DataKind, v: Pick<Value, "agg" | "of">) {
  return (
    v.agg === "count" ||
    v.agg === "distinct" ||
    v.agg === "daily" ||
    (data === "event" && v.agg === "sum" && v.of[0] === "value")
  );
}

/** Panels saved before data and values replaced measures. */
export type LegacyPanel = Omit<Panel, "data" | "values" | "pivot"> & {
  measure:
    | "events"
    | "requests"
    | "errors"
    | "latency"
    | "logs"
    | "metric"
    | "distinct";
  distinct?: { dataset: "event" | "daily" | "log" | "span"; field: string };
  metric: string;
  aggregation: "avg" | "max" | "min" | "sum";
  pivot?: Pivot & {
    metrics?: string[];
    metricOptions?: {
      metric: string;
      aggregation?: "avg" | "max" | "min" | "sum";
      mark?: WorksheetMark;
    }[];
  };
};
/** Rewrites a panel saved with a measure into data and values. */
export function upgradePanel(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("measure" in raw)) return raw;
  const {
    measure,
    distinct,
    metric,
    aggregation,
    pivot: legacyPivot,
    fieldUnits: legacyUnits,
    ...rest
  } = raw as LegacyPanel;
  const { metrics, metricOptions, ...pivotRest } = legacyPivot ?? {
    row: [],
    column: [],
  };
  let data: DataKind;
  let values: Value[];
  let label: (old: string) => string | undefined;
  switch (measure) {
    case "requests":
      data = "request";
      values = [{ agg: "count", of: [] }];
      break;
    case "errors":
      data = "request";
      values = [{ agg: "ratio", of: ["failed"] }];
      break;
    case "latency":
      data = "request";
      values = [{ agg: "p95", of: ["value"] }];
      break;
    case "logs":
      data = "log";
      values = [{ agg: "count", of: [] }];
      break;
    case "events":
      data = "event";
      values = [{ agg: "sum", of: ["value"] }];
      break;
    case "metric":
      data = "metric";
      values = [metric, ...(metrics ?? [])].map((m) => {
        const o = metricOptions?.find((x) => x.metric === m);
        const v: Value = {
          agg: o?.aggregation ?? aggregation ?? "avg",
          of: [`metric:${m}`],
        };
        if (o?.mark) v.mark = o.mark;
        return v;
      });
      break;
    default:
      if (distinct?.dataset === "daily") {
        data = "daily";
        values = [{ agg: "daily", of: [`set:${distinct.field}`] }];
      } else {
        data = distinct?.dataset ?? "span";
        values = [{ agg: "distinct", of: [`attr:${distinct?.field ?? ""}`] }];
      }
  }
  if (measure === "metric")
    label = (old) => {
      const v = values.find((x) => metricOf(x.of[0]) === old);
      return v && valueKey(v);
    };
  else label = () => valueKey(values[0]);
  const panel: Record<string, unknown> = { ...rest, data, values };
  if (legacyUnits) {
    const fieldUnits = { ...legacyUnits };
    if (measure !== "metric" && fieldUnits[measure] !== undefined) {
      fieldUnits[unitKey(values[0])] = fieldUnits[measure];
      delete fieldUnits[measure];
    }
    panel.fieldUnits = fieldUnits;
  }
  if (legacyPivot) {
    const pivot: Pivot = { ...pivotRest };
    const measureChannels = Object.entries(pivot.encoding ?? {})
      .filter(([, f]) => f === "measure")
      .map(([ch]) => ch);
    if (pivot.styleRules && measureChannels.length)
      pivot.styleRules = pivot.styleRules.flatMap((r) => {
        if (!measureChannels.includes(r.channel)) return [r];
        const value = label(r.value);
        return value ? [{ ...r, value }] : [];
      });
    panel.pivot = pivot;
  }
  return panel;
}
/** The value whose cells carry `key` on the measure shelf, else the first. */
export function valueAt(panel: Pick<Panel, "values">, key?: string): Value {
  return panel.values.find((v) => valueKey(v) === key) ?? panel.values[0];
}
/** A value a kind of data starts with: its row count or first number. */
export function initialValue(
  data: DataKind,
  meta: { metrics: string[]; dailyFields: string[] },
): Value {
  if (aggsFor(data, []).length) return { agg: "count", of: [] };
  const field = measurableFields(data, meta)[0];
  return field
    ? { agg: defaultAgg(data, [field]), of: [field] }
    : { agg: "count", of: [] };
}
