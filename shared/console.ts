/*
 * The vocabulary shared by the console and the server: queries, panels,
 * dashboards, monitors and the field dictionary that names what they show.
 *
 * Nothing here knows a particular metric, attribute or daily set. Names,
 * descriptions and units come from the field dictionary, which senders fill
 * and people override.
 */

export type Identifier =
  | "source"
  | "slot"
  | "revision"
  | "workload"
  | "instance";
export type Axis = Identifier | "day";
export type Attribute = `attr:${string}`;
export const isAttribute = (key: string): key is Attribute =>
  key.startsWith("attr:");
export type Dimension = Axis | Attribute;
export const identifiers: Identifier[] = [
  "source",
  "slot",
  "revision",
  "instance",
  "workload",
];
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

/* ---------------------------------------------------------------- fields */

/** What a sender or a person says about a field. Every part is optional. */
export interface FieldMeta {
  label?: string;
  description?: string;
  /** The unit values are stored in, such as `B` or `ms`. */
  unit?: string;
  /** The unit people prefer to read, such as `MiB` or `%`. */
  display?: string;
  /** A gauge is read as is; a counter only grows and is read as a rate. */
  kind?: "gauge" | "counter";
  /** The aggregation a field gets when placed as a value. */
  agg?: Agg;
}
/** A field's effective description: what people set over what senders sent. */
export interface FieldInfo extends FieldMeta {
  key: string;
  label: string;
  sender: FieldMeta;
  user: FieldMeta;
}
export type Dictionary = Record<string, FieldInfo>;

/**
 * Fields every row has, described by yuniview itself as their sender. People
 * may rename them like any other field.
 */
export const coreFields: Record<string, FieldMeta> = {
  source: { label: "サービス" },
  slot: { label: "スロット" },
  revision: { label: "リビジョン" },
  instance: { label: "インスタンス" },
  workload: { label: "ワークロード" },
  day: { label: "日付（JST）" },
  text: { label: "本文・名前", description: "ログの本文、スパンや指標の名前" },
  failed: { label: "失敗", description: "5xx 応答またはエラー状態のスパン" },
  "value:request": {
    label: "所要時間",
    unit: "ms",
    agg: "p95",
    description: "サーバーが要求を処理した時間",
  },
  "value:span": { label: "所要時間", unit: "ms", agg: "p95" },
  "value:event": {
    label: "実行回数",
    unit: "件",
    agg: "sum",
    description: "イベントが報告した回数",
  },
};

/** The dictionary key of a field as a kind of data shows it. */
export function fieldKey(data: DataKind, field: string) {
  return field === "value" ? `value:${data}` : field;
}
/** The words a key reads as when nobody named it. */
function bareName(key: string) {
  if (isAttribute(key)) return key.slice(5);
  if (key.startsWith("metric:")) return key.slice(7);
  if (key.startsWith("set:")) return key.slice(4);
  if (isTimeField(key)) return timeBuckets[key];
  return key;
}
/** A field's effective meta, falling back to the core fields. */
export function fieldMeta(dict: Dictionary, key: string): FieldMeta {
  return { ...coreFields[key], ...dict[key] };
}
export function fieldName(dict: Dictionary, key: string) {
  if (isTimeField(key)) return timeBuckets[key];
  return fieldMeta(dict, key).label || bareName(key);
}
/** Merges sender and person meta over the core fields into the dictionary. */
export function describeField(
  key: string,
  sender: FieldMeta,
  user: FieldMeta,
): FieldInfo {
  const pick = <K extends keyof FieldMeta>(k: K) =>
    user[k] ?? sender[k] ?? coreFields[key]?.[k];
  const info: FieldInfo = {
    key,
    label: pick("label") || bareName(key),
    sender,
    user,
  };
  for (const k of ["description", "unit", "display", "kind", "agg"] as const) {
    const v = pick(k);
    if (v !== undefined) (info as unknown as Record<string, unknown>)[k] = v;
  }
  return info;
}

/* ---------------------------------------------------------------- shelves */

export type ShelfAxis = Dimension | TimeField | "measure";
export function shelfName(key: ShelfAxis | "text", dict: Dictionary = {}) {
  return key === "measure" ? "指標" : fieldName(dict, key);
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

/* ---------------------------------------------------------------- queries */

/** `text` matches a log body or a span or metric name. */
export type FilterField = Dimension | TimeField | "text";
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
/** A window ending at a given time and the conditions rows must meet. */
export interface Filter {
  minutes: number;
  conditions?: FieldCondition[];
}
export const defaults: Filter = { minutes: 60 };
/** Conditions of a dashboard or the top bar, applied over a panel's own. */
export function withConditions<T extends Filter>(
  q: T,
  extra: FieldCondition[] | undefined,
): T {
  if (!extra?.length) return q;
  const own = (q.conditions ?? []).filter(
    (c) => !extra.some((e) => e.field === c.field),
  );
  return { ...q, conditions: [...own, ...extra] };
}

export interface Panel extends Filter {
  fieldUnits?: Record<string, string>;
  styleDefaults?: Partial<Record<StyleChannel, number>>;
  fixedStyle?: Partial<Record<StyleChannel, number>>;
  wide?: boolean;
  id?: string;
  title: string;
  /** The rows the panel reads. */
  data: DataKind;
  /** What is measured over those rows; the measure shelf lists them in order. */
  values: Value[];
  group: "all" | Identifier | Attribute;
  display: "chart" | "value" | "table" | "pivot";
  pivot?: Pivot;
}
export function chartBucketSeconds(minutes: number) {
  return Math.max(1, Math.ceil((minutes * 60) / 40));
}
export function changeGroup(p: Panel, group: Panel["group"]): Panel {
  return { ...p, group };
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
  /** Conditions every panel of the dashboard is read with. */
  conditions?: FieldCondition[];
}
/** The dashboard the home page shows, made from a template until saved. */
export const homeDashboardId = "00000000-0000-4000-8000-000000000001";
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
/** What one row was decoded from, while the delivered payload is kept. */
export type RawRow = { receivedAt: string } & (
  | { expired: false; raw: unknown }
  | { expired: true }
);
export interface Overview {
  services: {
    source: string;
    last: string | null;
    requests: number;
    errors: number;
    latency: number | null;
  }[];
  metrics: string[];
  dailyFields: string[];
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
/** How often a monitor would have changed state over a past period. */
export interface Backtest {
  days: number;
  windows: number;
  alert: number;
  ok: number;
  noData: number;
}
/** A count of rows having one value of a field. */
export interface TopValue {
  value: string;
  count: number;
}
export const blankPanel: Panel = {
  ...defaults,
  title: "リクエスト数",
  data: "request",
  values: [{ agg: "count", of: [] }],
  group: "source",
  display: "chart",
};

/* ----------------------------------------------------------------- values */

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
  | "rate"
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
  rate: "増加率",
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
  /**
   * Two-stage aggregation: average the field per minute and per these
   * dimensions, add those averages up, then aggregate the sums with `agg`.
   */
  per?: Dimension[];
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
  if (of.length === 0) return data === "daily" ? [] : ["count"];
  if (of.length > 1)
    return of.every((f) => fieldType(f) === "dimension") ? ["distinct"] : [];
  switch (fieldType(of[0])) {
    case "number":
      return of[0].startsWith("metric:") ? [...numberAggs, "rate"] : numberAggs;
    case "boolean":
      return ["ratio"];
    case "set":
      return ["daily"];
    case "dimension":
      return data === "daily" || data === "metric" ? [] : ["distinct"];
  }
}
/** Aggregations a two-stage value applies to its per-minute sums. */
export const perAggs: Agg[] = ["avg", "max", "min"];
/** The aggregation a field gets when first placed as a value. */
export function defaultAgg(
  dict: Dictionary,
  data: DataKind,
  of: readonly ValueField[],
): Agg {
  const allowed = aggsFor(data, of);
  if (of.length === 1) {
    const meta = fieldMeta(dict, fieldKey(data, of[0]));
    if (meta.agg && allowed.includes(meta.agg)) return meta.agg;
    if (meta.kind === "counter" && allowed.includes("rate")) return "rate";
  }
  return allowed[0] ?? "count";
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
      return meta.metrics.map((m): ValueField => `metric:${m}`);
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
export function valueFieldName(
  dict: Dictionary,
  data: DataKind,
  field: ValueField,
) {
  return fieldName(dict, fieldKey(data, field));
}
/** The label cells carry for a value on the measure shelf. */
export function valueKey(v: Pick<Value, "agg" | "of" | "per">) {
  const per = v.per?.length ? `/${v.per.join(",")}` : "";
  return `${v.agg}(${v.of.join(",")})${per}`;
}
const countNames: Partial<Record<DataKind, string>> = {
  request: "リクエスト数",
  span: "スパン数",
  log: "ログ件数",
  event: "イベント件数",
  metric: "計測点数",
};
export function valueName(
  dict: Dictionary,
  data: DataKind,
  v: Pick<Value, "agg" | "of" | "per">,
) {
  if (v.agg === "count") return countNames[data] ?? "件数";
  const fields = v.of.map((f) => valueFieldName(dict, data, f)).join(" × ");
  if (v.per?.length) {
    const per = v.per.map((d) => fieldName(dict, d)).join("・");
    return `${fields}（${per}ごとの合計の${aggNames[v.agg]}）`;
  }
  if (v.agg === "avg" && metricOf(v.of[0]) !== undefined) return fields;
  if (v.agg === "rate") return fields + "の増加率";
  if (v.agg === "ratio") return fields + "率";
  if (v.agg === "distinct" && v.of.length > 1) return fields + " の組の種類数";
  return fields + " · " + aggNames[v.agg];
}
/** The key display units of a value are stored under in a panel. */
export function unitKey(v: Pick<Value, "agg" | "of" | "per">) {
  return valueKey(v);
}
/** The unit a value's numbers are in before any display conversion. */
export function valueUnit(
  dict: Dictionary,
  data: DataKind,
  v: Pick<Value, "agg" | "of">,
) {
  if (v.agg === "count" || v.agg === "distinct" || v.agg === "daily")
    return "件";
  if (v.agg === "ratio") return "%";
  const unit = fieldMeta(dict, fieldKey(data, v.of[0])).unit ?? "";
  return v.agg === "rate" ? `${unit}/s` : unit;
}
/** Whether a value counts things, so axes use whole numbers. */
export function countsWhole(dict: Dictionary, data: DataKind, v: Value) {
  return valueUnit(dict, data, v) === "件";
}
/** The value whose cells carry `key` on the measure shelf, else the first. */
export function valueAt(panel: Pick<Panel, "values">, key?: string): Value {
  return panel.values.find((v) => valueKey(v) === key) ?? panel.values[0];
}
/** A value a kind of data starts with: its row count or first number. */
export function initialValue(
  dict: Dictionary,
  data: DataKind,
  meta: { metrics: string[]; dailyFields: string[] },
): Value {
  const field = measurableFields(data, meta)[0];
  if (data === "daily" || (data === "metric" && field)) {
    const of: ValueField[] = field ? [field] : [];
    return { agg: defaultAgg(dict, data, of), of };
  }
  return { agg: "count", of: [] };
}

/* ------------------------------------------------------------------ units */

/** Units that convert into each other, by their size in the first unit. */
export const unitFamilies: Record<string, number>[] = [
  { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 },
  { ns: 1e-9, µs: 1e-6, ms: 0.001, s: 1 },
  { "µs/s": 1e-6, "ms/s": 0.001, "s/s": 1, コア: 1, "%": 0.01 },
];
export function compatibleUnits(unit: string) {
  return unitFamilies.find((f) => Object.hasOwn(f, unit));
}
/** Converts `value` from one unit to another of the same family. */
export function convertUnit(value: number, from: string, to: string) {
  const family = compatibleUnits(from);
  if (!family || !Object.hasOwn(family, to)) return value;
  return (value * family[from]) / family[to];
}

/* ---------------------------------------------------------- retention */

/** Kinds of stored rows a retention rule can name; daily sets are not rows. */
export type RowKind = Exclude<DataKind, "daily">;
/**
 * How long rows a rule picks out are kept. Rules are read in order and the
 * first one a row matches decides; rows no rule matches are kept forever.
 */
export interface RetentionRule {
  id: string;
  title: string;
  /** The kind of rows; every kind when absent. */
  data?: RowKind;
  /** Exact span, metric or log names; any name when absent. */
  names?: string[];
  conditions?: FieldCondition[];
  /** Minutes rows are kept after their time; null keeps them forever. */
  keep: number | null;
}
/** A saved rule with how many rows it took over the last day. */
export interface RetentionRuleView {
  rule: RetentionRule;
  /** Rows of the last 24 hours this rule decides, after earlier rules. */
  perDay: number;
  /** Rows before this time have been swept; null until the first sweep. */
  sweptUntil: string | null;
}
