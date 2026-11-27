import { createHash } from "node:crypto";

/**
 * The OTLP resource a sender attaches to its spans, logs and metrics: which
 * process they came from. Stored once per distinct content, since every row
 * of a process carries the same one.
 */
export interface Resource {
  /** Hex of the first 16 bytes of the SHA-256 of the canonical attributes. */
  digest: string;
  attrs: Record<string, unknown>;
}

export namespace Resource {
  /** The resource with these attributes, or null when there are none. */
  export function of(attrs: Record<string, unknown>): Resource | null {
    if (Object.keys(attrs).length === 0) return null;
    const digest = createHash("sha256")
      .update(canonical(attrs))
      .digest()
      .subarray(0, 16)
      .toString("hex");
    return { digest, attrs };
  }
}

/** JSON with object keys in order, so equal content gives equal text. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x !== null && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(x) ?? "null";
}
