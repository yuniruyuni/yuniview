import { z } from "zod";
import {
  aggsFor,
  type DataKind,
  fieldType,
  perAggs,
  pivotFields,
  type TimeField,
  timeBuckets,
  type ValueField,
  valueKey,
} from "../../../../shared/console";

const label = z
  .string()
  .max(512)
  .refine((s) => !s.includes("\0"));
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
    field: filterField.or(z.literal("text")),
    contains: label.optional(),
    values: z.array(label).max(256).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((c) =>
    c.field === "text"
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
const minutes = z.number().int().min(1).max(43200);
export const filter = z.object({
  minutes,
  conditions: conditions.optional(),
});
const data = z.enum(["request", "span", "log", "event", "metric", "daily"]);
/** A kind of data, its window and its conditions. */
export const query = filter.extend({ data });
/** A query with the values whose metrics or sets it is narrowed to. */
export const scope = query.extend({
  values: z
    .array(
      z.object({
        agg: z.string().max(16),
        of: z.array(z.string().max(520)).max(8),
      }),
    )
    .max(12)
    .optional(),
});
const shelf = shelfField.or(z.array(shelfField).max(32));
const mark = z.enum(["auto", "table", "line", "bar", "area", "stacked_area"]);
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
const agg = z.enum([
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "p50",
  "p95",
  "p99",
  "rate",
  "distinct",
  "ratio",
  "daily",
]);
const value = z.object({
  agg,
  of: z.array(valueField).max(8),
  per: z.array(axis).min(1).max(4).optional(),
  mark: mark.optional(),
});
/** Whether a value is something the panel's data can measure. */
function measurable(kind: DataKind, v: z.infer<typeof value>) {
  if (!aggsFor(kind, v.of).includes(v.agg)) return false;
  if (new Set(v.of).size !== v.of.length) return false;
  if (
    v.per &&
    (v.of.length !== 1 ||
      fieldType(v.of[0]) !== "number" ||
      !perAggs.includes(v.agg) ||
      kind === "daily")
  )
    return false;
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
export const panel = query
  .extend({
    id: z.uuid().optional(),
    wide: z.boolean().optional(),
    fieldUnits: z.record(label, z.string().trim().min(1).max(32)).optional(),
    fixedStyle: styles,
    styleDefaults: styles,
    yAxis: z
      .object({ min: z.number().optional(), max: z.number().optional() })
      .refine(
        (a) => a.min === undefined || a.max === undefined || a.min < a.max,
        "縦軸の下端は上端より小さくしてください",
      )
      .optional(),
    title: label.pipe(z.string().trim().min(1)),
    values: z.array(value).min(1).max(12),
    group: z
      .enum(["all", "source", "slot", "revision", "instance", "workload"])
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
  })
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
        pivotFields(p.pivot).includes("measure")),
    "複数の値には指標の軸を指定してください",
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
  .refine((p) => {
    if (p.data !== "daily") return true;
    if (p.conditions?.some((c) => c.field !== "day" && c.field !== "source"))
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
export const dashboard = z.object({
  id: z.uuid(),
  title: label.pipe(z.string().trim().min(1)),
  panels: z.array(panel).max(24),
  conditions: conditions.optional(),
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
/** What a person says about a field; null clears that part. */
export const fieldMeta = z.object({
  key: label.pipe(z.string().min(1)),
  label: label.nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  unit: z.string().max(32).nullable().optional(),
  display: z.string().max(32).nullable().optional(),
  kind: z.enum(["gauge", "counter"]).nullable().optional(),
  agg: agg.nullable().optional(),
});
