import { z } from "zod";
import {
  cpuPercent,
  pivotFields,
  shelfFields,
  type TimeField,
  timeBuckets,
} from "../../../shared/console";

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
const shelfField = axis
  .or(z.literal("measure"))
  .or(z.enum(Object.keys(timeBuckets) as [TimeField, ...TimeField[]]));
const shelf = shelfField.or(z.array(shelfField).max(32));
export const panel = filter
  .extend({
    id: z.uuid().optional(),
    wide: z.boolean().optional(),
    title: label.pipe(z.string().trim().min(1)),
    measure: z.enum([
      "requests",
      "errors",
      "latency",
      "logs",
      "metric",
      "distinct",
    ]),
    distinct: z
      .object({
        dataset: z.enum(["daily", "log", "span"]),
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
    aggregation: z.enum(["avg", "max", "min", "sum"]),
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
        row: shelf,
        column: shelf,
        series: shelf.optional(),
        mark: z.enum(["auto", "table", "line"]).optional(),
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
    if (p.slot || p.instance || p.revision || p.workload || p.text)
      return false;
    if (p.display === "chart") return p.group === "source";
    return (
      p.display === "pivot" &&
      !!p.pivot &&
      !shelfFields(p.pivot.series).length &&
      pivotFields(p.pivot).length === 2 &&
      pivotFields(p.pivot).every((axis) => axis === "source" || axis === "day")
    );
  }, "対象フィールドを指定してください。日次集合はサービス別の折れ線または日付×サービスの表で集計できます")
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
