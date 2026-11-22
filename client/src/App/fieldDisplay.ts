import {
  cpuPercent,
  fieldZone,
  isTimeField,
  type Panel,
  type Point,
  type ShelfAxis,
  shelfFields,
} from "../../../shared/console";

const bytes: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
};
const durations: Record<string, number> = {
  ns: 1e-9,
  µs: 1e-6,
  ms: 0.001,
  s: 1,
};
export function nativeUnit(panel: Panel, metric: string) {
  if (panel.measure === "metric") {
    if (metric === "memory.current") return panel.unit ?? "B";
    if (metric === "cpu.usage") return "µs";
    if (metric === cpuPercent) return "%";
    return "";
  }
  return panel.measure === "latency"
    ? "ms"
    : panel.measure === "errors"
      ? "%"
      : "件";
}
export function compatibleUnits(unit: string) {
  return Object.hasOwn(bytes, unit)
    ? bytes
    : Object.hasOwn(durations, unit)
      ? durations
      : undefined;
}
export function displayPoints(panel: Panel, points: Point[]) {
  const pivot = panel.pivot;
  const row = shelfFields(pivot?.row).indexOf("measure");
  const col = shelfFields(pivot?.column).indexOf("measure");
  return points.map((p) => {
    const metric =
      row >= 0
        ? (p.rowPath ?? [p.series])[row]
        : col >= 0
          ? (p.columnPath ?? [p.column])[col]
          : panel.metric;
    const key =
      panel.measure === "metric"
        ? "metric/" + (metric ?? panel.metric)
        : panel.measure;
    const unit = panel.fieldUnits?.[key];
    const source =
      panel.unit ?? p.metricUnit ?? nativeUnit(panel, metric ?? panel.metric);
    const scale = compatibleUnits(source);
    if (!unit || !scale || !Object.hasOwn(scale, unit))
      return source &&
        source !== p.metricUnit &&
        (panel.unit || panel.display === "table" || panel.display === "pivot")
        ? { ...p, metricUnit: source }
        : p;
    return {
      ...p,
      metricUnit: unit,
      value: (p.value * scale[source]) / scale[unit],
    };
  });
}
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
const dateFormats = { JST: timeFormat("Asia/Tokyo"), UTC: timeFormat("UTC") };
export function displayField(panel: Panel, field: ShelfAxis, value: string) {
  if (isTimeField(field) && Number.isFinite(Date.parse(value))) {
    if (field === "time:86400")
      return new Date(value).toISOString().slice(0, 10);
    return dateFormats[fieldZone(panel.pivot, field)].format(new Date(value));
  }
  return value;
}
