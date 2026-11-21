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
export const panel = filter
  .extend({
    id: z.uuid().optional(),
    title: label.pipe(z.string().trim().min(1)),
    measure: z.enum(["requests", "errors", "latency", "logs", "metric"]),
    metric: label,
    aggregation: z.enum(["avg", "max", "min", "sum"]),
    group: z.enum([
      "all",
      "source",
      "slot",
      "revision",
      "instance",
      "workload",
    ]),
    display: z.enum(["chart", "value", "table"]),
  })
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
  panel,
  threshold: z.number(),
  operator: z.enum(["above", "below"]),
  minimum: z.number().int().min(1),
  missing: z.enum(["alert", "no_data"]),
  notify: z.boolean(),
});
