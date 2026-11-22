import { z } from "zod";

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
const axis = z.enum([
  "source",
  "slot",
  "revision",
  "workload",
  "instance",
  "day",
]);
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
    group: z.enum([
      "slot_total",
      "all",
      "source",
      "slot",
      "revision",
      "instance",
      "workload",
    ]),
    display: z.enum(["chart", "value", "table", "pivot"]),
    pivot: z.object({ row: axis, column: axis }).optional(),
    unit: z.literal("MiB").optional(),
  })
  .refine(
    (p) =>
      p.group !== "slot_total" ||
      (p.measure === "metric" &&
        p.display !== "pivot" &&
        p.aggregation !== "sum" &&
        !p.slot &&
        !p.instance),
    "スロット合計は両方のスロットを対象とするメトリクスで使用できます",
  )
  .refine(
    (p) => p.display !== "pivot" || (p.pivot && p.pivot.row !== p.pivot.column),
    "行と列には異なる項目が必要です",
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
      [p.pivot?.row, p.pivot?.column].every(
        (axis) => axis === "source" || axis === "day",
      )
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
