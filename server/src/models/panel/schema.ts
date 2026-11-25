import { z } from "zod";
import {
  cpuPercent,
  pivotFields,
  type TimeField,
  timeBuckets,
  usesLogRecords,
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
const shelf = shelfField.or(z.array(shelfField).max(32));
const aggregation = z.enum(["avg", "max", "min", "sum"]);
const mark = z.enum(["auto", "table", "line", "bar", "area", "stacked_area"]);
const styles = z
  .object({
    color: z.number().int().min(0).max(6).optional(),
    dash: z.number().int().min(0).max(2).optional(),
    width: z.number().int().min(0).max(2).optional(),
    shape: z.number().int().min(0).max(2).optional(),
  })
  .optional();
export const panel = filter
  .extend({
    id: z.uuid().optional(),
    wide: z.boolean().optional(),
    fieldUnits: z.record(label, z.string().trim().min(1).max(32)).optional(),
    fixedStyle: styles,
    styleDefaults: styles,
    conditions: z
      .array(condition)
      .max(32)
      .refine((cs) => new Set(cs.map((c) => c.field)).size === cs.length)
      .optional(),
    title: label.pipe(z.string().trim().min(1)),
    measure: z.enum([
      "events",
      "requests",
      "errors",
      "latency",
      "logs",
      "metric",
      "distinct",
    ]),
    distinct: z
      .object({
        dataset: z.enum(["event", "daily", "log", "span"]),
        field: label.pipe(z.string().min(1)),
      })
      .optional(),
    metric: label,
    totalSlots: z
      .array(label.pipe(z.string().min(1)))
      .min(1)
      .max(32)
      .refine((slots) => new Set(slots).size === slots.length)
      .optional(),
    aggregation,
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
        metricOptions: z
          .array(
            z.object({
              metric: label,
              aggregation: aggregation.optional(),
              mark: mark.optional(),
            }),
          )
          .max(13)
          .optional(),
        metrics: z
          .array(label.pipe(z.string().min(1)))
          .min(1)
          .max(12)
          .optional(),
      })
      .optional(),
    unit: z.literal("MiB").optional(),
  })
  .refine(
    (p) => !p.conditions?.some((c) => c.field === "log") || usesLogRecords(p),
    "ログ本文はログを集計する指標で使用できます",
  )
  .refine(
    (p) =>
      p.group !== "slot_total" ||
      (p.measure === "metric" &&
        p.metric !== cpuPercent &&
        p.display !== "pivot" &&
        p.aggregation !== "sum" &&
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
  .refine((p) => {
    const opts = p.pivot?.metricOptions;
    return (
      !opts?.length ||
      (p.display === "pivot" &&
        p.measure === "metric" &&
        !!p.pivot &&
        pivotFields(p.pivot).includes("measure") &&
        new Set(opts.map((o) => o.metric)).size === opts.length &&
        opts.every((o) =>
          [p.metric, ...(p.pivot?.metrics ?? [])].includes(o.metric),
        ))
    );
  }, "指標設定は棚に配置した指標を指定してください")
  .refine(
    (p) =>
      !p.pivot?.metrics ||
      (p.display === "pivot" &&
        p.measure === "metric" &&
        !p.unit &&
        pivotFields(p.pivot).includes("measure") &&
        !p.pivot.metrics.includes(p.metric) &&
        new Set(p.pivot.metrics).size === p.pivot.metrics.length),
    "複数のメトリクスには指標名の軸を指定してください",
  )
  .refine(
    (p) => !p.unit || (p.measure === "metric" && p.metric === "memory.current"),
    "MiB はメモリに使用できます",
  )
  .refine((p) => {
    if (p.measure !== "distinct") return !p.distinct;
    if (!p.distinct) return false;
    if (p.distinct.dataset !== "daily") return true;
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
  }, "日次集合で使用できるフィールドは時刻（1日・JST）、サービス、指標です")
  .refine(
    (p) => p.measure !== "metric" || p.metric.length > 0,
    "指標を選択してください",
  );
export const dashboard = z.object({
  id: z.uuid(),
  title: label.pipe(z.string().trim().min(1)),
  panels: z.array(panel).min(1).max(24),
});
export const monitor = z.object({
  id: z.uuid(),
  title: label.pipe(z.string().trim().min(1)),
  panel: panel.refine(
    (p) => p.display !== "pivot" && p.distinct?.dataset !== "daily",
    "モニターには単一系列の集計を指定してください",
  ),
  threshold: z.number(),
  operator: z.enum(["above", "below"]),
  minimum: z.number().int().min(1),
  missing: z.enum(["alert", "no_data"]),
  notify: z.boolean(),
});
