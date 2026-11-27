import { z } from "zod";
import { conditions } from "../panel/schema";

const name = z
  .string()
  .min(1)
  .max(512)
  .refine((s) => !s.includes("\0"));
/** A retention rule as the console saves it. */
export const retentionRule = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    data: z.enum(["request", "span", "log", "event", "metric"]).optional(),
    names: z.array(name).min(1).max(64).optional(),
    conditions: conditions.optional(),
    // Up to ten years, in minutes; null keeps rows forever.
    keep: z
      .number()
      .int()
      .min(1)
      .max(3650 * 1440)
      .nullable(),
  })
  .strict();
