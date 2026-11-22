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
export interface Panel extends Filter {
  wide?: boolean;
  id?: string;
  title: string;
  measure: Measure;
  distinct?: Distinct;
  metric: string;
  totalSlots?: string[];
  aggregation: "avg" | "max" | "min" | "sum";
  group: "all" | "slot_total" | Identifier;
  display: "chart" | "value" | "table" | "pivot";
  pivot?: { row: Axis; column: Axis };
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
