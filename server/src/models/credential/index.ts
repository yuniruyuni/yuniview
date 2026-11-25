import { createHash } from "node:crypto";
import type { Envelope } from "../batch";
import { type Comp, defineSpecs, type SpecsOf } from "../common";

/** The scope a source-specific bearer token may deliver for. */
export interface Credential {
  tokenSha256: string;
  source: string;
  workload: string;
  slot: string;
}

export namespace Credential {
  const _specs = defineSpecs({
    ByToken: (token: string) => ({
      digest: createHash("sha256").update(token).digest("hex"),
    }),
  });
  export const ByToken = _specs.ByToken;
  export type Spec = Comp<SpecsOf<typeof _specs>>;

  export function covers(c: Credential, source: Envelope["source"]) {
    return (
      source.service === c.source &&
      source.workload === c.workload &&
      (source.slot ?? "") === c.slot
    );
  }
}
