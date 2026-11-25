import type { VisitOutcome } from "../../models/visit";
import type { ServiceCtx } from "../common/capability";

/** The local agent's private socket that counts daily visits. */
export class UsageAgentRepository {
  constructor(private readonly socket = "/run/yuniview-otlp/usage.sock") {}

  async visit(_ctx: ServiceCtx, subject: string): Promise<VisitOutcome> {
    try {
      const response = await fetch("http://localhost/visit", {
        unix: this.socket,
        method: "POST",
        body: subject,
        signal: AbortSignal.timeout(1500),
      });
      return response.status === 204 ? "recorded" : "unavailable";
    } catch {
      return "unavailable";
    }
  }
}
