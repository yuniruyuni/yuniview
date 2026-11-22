export type Measure =
  | "requests"
  | "errors"
  | "latency"
  | "logs"
  | "metric"
  | "distinct";
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
  day: "日付（JST）",
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
export function shelfName(key: ShelfAxis) {
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
export type WorksheetMark = "auto" | "table" | "line" | "bar" | "stacked_area";
export interface MetricOption {
  metric: string;
  aggregation?: Panel["aggregation"];
  mark?: WorksheetMark;
}
export type Pivot = {
  row: ShelfFields;
  column: ShelfFields;
  series?: ShelfFields;
  mark?: WorksheetMark;
  metricOptions?: MetricOption[];
  metrics?: string[];
};
export type Distinct = { dataset: "daily" | "log" | "span"; field: string };
export interface Filter {
  source: string;
  instance: string;
  workload: string;
  slot: string;
  revision: string;
  text: string;
  minutes: number;
}
export type FilterField = Dimension | TimeField;
export interface FieldCondition {
  field: FilterField;
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
  conditions?: FieldCondition[];
  wide?: boolean;
  id?: string;
  title: string;
  measure: Measure;
  distinct?: Distinct;
  metric: string;
  totalSlots?: string[];
  aggregation: "avg" | "max" | "min" | "sum";
  group: "all" | "slot_total" | Identifier | Attribute;
  display: "chart" | "value" | "table" | "pivot";
  pivot?: Pivot;
  unit?: "MiB";
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
    aggregation: p.aggregation === "sum" ? "avg" : p.aggregation,
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
  measure: "requests",
  metric: "",
  aggregation: "avg",
  group: "source",
  display: "chart",
};
export const measures: Record<Measure, string> = {
  distinct: "ユニーク数",
  requests: "リクエスト数",
  errors: "失敗率 (%)",
  latency: "p95 応答時間 (ms)",
  logs: "ログ件数",
  metric: "メトリクス",
};
