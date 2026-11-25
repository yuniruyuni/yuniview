import { type Fail, fail } from "../../models/common";
import type { ServiceCtx } from "../common/capability";

/** Delivers monitor notifications to the configured endpoint. */
export class WebhookRepository {
  constructor(private readonly url: string | undefined) {}

  async send(
    _ctx: ServiceCtx,
    idempotencyKey: string,
    body: object,
  ): Promise<true | Fail> {
    if (!this.url) return fail("UNAVAILABLE", "no webhook is configured");
    try {
      const res = await fetch(this.url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      await res.body?.cancel();
      return res.ok ? true : fail("UNAVAILABLE", `HTTP ${res.status}`);
    } catch (e) {
      return fail("UNAVAILABLE", e instanceof Error ? e.message : "failed");
    }
  }
}
