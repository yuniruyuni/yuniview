import { z } from "zod";
import {
  aggsFor,
  cpuPercent,
  type DataKind,
  fieldType,
  metricOf,
  pivotFields,
  type TimeField,
  timeBuckets,
  upgradePanel,
  usesLogRecords,
  type ValueField,
  valueKey,
} from "../../../../shared/console";

const label = z
  .string()
  .max(512)
  .refine((s) => !s.includes("\0"));
export const filter = z.object({
  source: label,
  instance: label.default(""),
  workload: label.default(""),
  slot: label,
  revision: label,
  text: label,
  minutes: z.number().int().min(1).max(43200),
});
const attribute = z
  .templateLiteral(["attr:", z.string().min(1)])
  .refine((k) => k.length > 5 && k.length <= 261 && !k.includes("\0"));
const axis = z
  .enum(["source", "slot", "revision", "workload", "instance", "day"])
  .or(attribute);
export const filterField = axis.or(
  z.enum(Object.keys(timeBuckets) as [TimeField, ...TimeField[]]),
);
const shelfField = filterField.or(z.literal("measure"));
const condition = z
  .object({
    field: filterField.or(z.literal("log")),
    contains: label.optional(),
    values: z.array(label).max(256).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((c) =>
    c.field === "log"
      ? !c.values && c.min === undefined && c.max === undefined
      : c.contains === undefined,
  )
  .refine(
    (c) =>
      (!c.values || (c.min === undefined && c.max === undefined)) &&
      (c.min === undefined || c.max === undefined || c.min <= c.max),
  )
  .refine(
    (c) =>
      (c.min === undefined && c.max === undefined) ||
      c.field.startsWith("attr:") ||
      c.field === "day" ||
      c.field.startsWith("time:"),
  );
/** Conditions of a worksheet, each field at most once. */
export const conditions = z
  .array(condition)
  .max(32)
  .refine((cs) => new Set(cs.map((c) => c.field)).size === cs.length);
const shelf = shelfField.or(z.array(shelfField).max(32));
const mark = z.enum(["auto", "table", "line", "bar", "area", "stacked_area"]);
const data = z.enum(["request", "span", "log", "event", "metric", "daily"]);
const valueField = z.union([
  z.enum(["value", "failed"]),
  z
    .templateLiteral(["metric:", z.string().min(1)])
    .refine((k) => k.length <= 519 && !k.includes("\0")),
  z
    .templateLiteral(["set:", z.string().min(1)])
    .refine((k) => k.length <= 516 && !k.includes("\0")),
  axis,
]);
const value = z.object({
  agg: z.enum([
    "count",
    "sum",
    "avg",
    "min",
    "max",
    "p50",
    "p95",
    "p99",
    "distinct",
    "ratio",
    "daily",
  ]),
  of: z.array(valueField).max(8),
  mark: mark.optional(),
});
/** Whether every value is something the panel's data can measure. */
function measurable(kind: DataKind, v: z.infer<typeof value>) {
  if (!aggsFor(kind, v.of).includes(v.agg)) return false;
  if (new Set(v.of).size !== v.of.length) return false;
  return v.of.every((f: ValueField) => {
    switch (fieldType(f)) {
      case "number":
        return f === "value"
          ? kind === "request" || kind === "span" || kind === "event"
          : kind === "metric";
      case "boolean":
        return kind === "request" || kind === "span";
      case "set":
        return kind === "daily";
      case "dimension":
        return kind !== "daily" && kind !== "metric";
      default:
        return false;
    }
  });
}
const styles = z
  .object({
    color: z.number().int().min(0).max(6).optional(),
    dash: z.number().int().min(0).max(2).optional(),
    width: z.number().int().min(0).max(2).optional(),
    shape: z.number().int().min(0).max(2).optional(),
  })
  .optional();
const current = filter
  .extend({
    id: z.uuid().optional(),
    wide: z.boolean().optional(),
    fieldUnits: z.record(label, z.string().trim().min(1).max(32)).optional(),
    fixedStyle: styles,
    styleDefaults: styles,
    conditions: conditions.optional(),
    title: label.pipe(z.string().trim().min(1)),
    data,
    values: z.array(value).min(1).max(12),
    totalSlots: z
      .array(label.pipe(z.string().min(1)))
      .min(1)
      .max(32)
      .refine((slots) => new Set(slots).size === slots.length)
      .optional(),
    group: z
      .enum([
        "slot_total",
        "all",
        "source",
        "slot",
        "revision",
        "instance",
        "workload",
      ])
      .or(attribute),
    display: z.enum(["chart", "value", "table", "pivot"]),
    pivot: z
      .object({
        timeZones: z
          .record(
            z.string().regex(/^time:(1|10|60|300|3600)$/),
            z.enum(["UTC", "JST"]),
          )
          .optional(),
        styleRules: z
          .array(
            z
              .object({
                channel: z.enum(["color", "dash", "width", "shape"]),
                value: label,
                index: z.number().int().min(0).max(6),
              })
              .refine((r) => r.channel === "color" || r.index < 3),
          )
          .max(256)
          .optional(),
        encoding: z
          .object({
            color: shelfField.optional(),
            dash: shelfField.optional(),
            width: shelfField.optional(),
            shape: shelfField.optional(),
          })
          .optional(),
        row: shelf,
        column: shelf,
        series: shelf.optional(),
        mark: mark.optional(),
      })
      .optional(),
    unit: z.literal("MiB").optional(),
  })
  .refine(
    (p) => !p.conditions?.some((c) => c.field === "log") || usesLogRecords(p),
    "ログ本文はログを集計する指標で使用できます",
  )
  .refine(
    (p) => p.values.every((v) => measurable(p.data, v)),
    "値には選んだデータで集計できるフィールドと集計方法を指定してください",
  )
  .refine(
    (p) => new Set(p.values.map(valueKey)).size === p.values.length,
    "同じ値は一度だけ指定してください",
  )
  .refine(
    (p) =>
      p.values.length === 1 ||
      (p.display === "pivot" &&
        !!p.pivot &&
        pivotFields(p.pivot).includes("measure") &&
        !p.unit),
    "複数の値には指標の軸を指定してください",
  )
  .refine(
    (p) =>
      p.group !== "slot_total" ||
      (p.data === "metric" &&
        p.values.length === 1 &&
        metricOf(p.values[0].of[0]) !== cpuPercent &&
        ["avg", "min", "max"].includes(p.values[0].agg) &&
        p.display !== "pivot" &&
        !p.slot &&
        !p.instance),
    "スロット合計は両方のスロットを対象とするメトリクスで使用できます",
  )
  .refine(
    (p) =>
      p.display !== "pivot" ||
      (p.pivot &&
        new Set(pivotFields(p.pivot)).size === pivotFields(p.pivot).length),
    "行・列・系列には異なるフィールドを指定してください",
  )
  .refine(
    (p) =>
      !p.values.some((v) => v.mark) ||
      (p.display === "pivot" &&
        !!p.pivot &&
        pivotFields(p.pivot).includes("measure")),
    "値ごとの表示形式は指標の軸を指定したときに使用できます",
  )
  .refine(
    (p) =>
      !p.unit ||
      (p.values.length === 1 &&
        metricOf(p.values[0].of[0]) === "memory.current"),
    "MiB はメモリに使用できます",
  )
  .refine((p) => {
    if (p.data !== "daily") return true;
    if (p.conditions?.some((c) => c.field !== "day" && c.field !== "source"))
      return false;
    if (p.slot || p.instance || p.revision || p.workload || p.text)
      return false;
    return (
      (p.group === "source" || p.group === "all") &&
      (!p.pivot ||
        [
          ...pivotFields(p.pivot),
          ...Object.values(p.pivot.encoding ?? {}),
        ].every(
          (axis) => axis === "source" || axis === "day" || axis === "measure",
        ))
    );
  }, "日次集合で使用できるフィールドは時刻（1日・JST）、サービス、指標です");
/** Accepts panels saved with a measure, rewriting them into data and values. */
export const panel = z.preprocess(upgradePanel, current);
export const dashboard = z.object({
  id: z.uuid(),
  title: label.pipe(z.string().trim().min(1)),
  panels: z.array(panel).min(1).max(24),
});
export const monitor = z.object({
  id: z.uuid(),
  title: label.pipe(z.string().trim().min(1)),
  panel: panel.refine(
    (p) => p.display !== "pivot" && p.data !== "daily" && p.values.length === 1,
    "モニターには単一系列の集計を指定してください",
  ),
  threshold: z.number(),
  operator: z.enum(["above", "below"]),
  minimum: z.number().int().min(1),
  missing: z.enum(["alert", "no_data"]),
  notify: z.boolean(),
});
