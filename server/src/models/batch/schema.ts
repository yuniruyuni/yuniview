import { z } from "zod";

const label = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !s.includes("\0"));
export const bufferedEvents = z.array(
  z
    .object({
      name: z
        .string()
        .min(1)
        .refine((s) => !s.includes("\0")),
      at: z.iso.datetime({ offset: true }),
      count: z.number().int().positive(),
      attrs: z.record(
        z.string().refine((s) => !s.includes("\0")),
        z.string().refine((s) => !s.includes("\0")),
      ),
    })
    .strict(),
);
export const batchSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  source: z.object({
    service: label,
    workload: label,
    instance: label,
    slot: label.optional(),
    revision: label.optional(),
  }),
  time: z.iso.datetime({ offset: true }),
  signal: z.enum([
    "traces",
    "metrics",
    "logs",
    "resources",
    "stdout",
    "usage",
    "daily_set",
  ]),
  payload: z.union([z.record(z.string(), z.unknown()), z.array(z.string())]),
});
export const usageMark = z
  .object({
    day: z.iso.date(),
    kind: z.enum(["browser", "account"]),
    digest: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  })
  .strict();
export const dailySet = usageMark
  .omit({ kind: true })
  .extend({
    field: label,
    label: label.optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();
/** A batch as an agent delivers it. */
export type Envelope = z.infer<typeof batchSchema>;
