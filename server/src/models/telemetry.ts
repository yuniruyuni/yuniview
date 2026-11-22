import { z } from "zod";

const label = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !s.includes("\0"));
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
  signal: z.enum(["traces", "metrics", "logs", "resources", "stdout", "usage"]),
  payload: z.union([z.record(z.string(), z.unknown()), z.array(z.string())]),
});
export const usageMark = z
  .object({
    day: z.iso.date(),
    kind: z.enum(["browser", "account"]),
    digest: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  })
  .strict();
export type Batch = z.infer<typeof batchSchema>;
