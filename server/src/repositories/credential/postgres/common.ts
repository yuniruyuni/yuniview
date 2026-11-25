import { type SQLFragment, sql } from "../../../infra/db/sql";
import type { Credential } from "../../../models/credential";

type CredentialSpecData = Exclude<
  Credential.Spec,
  { type: "And" | "Or" | "Not" | "All" }
>;
export function credentialSpecToSQL(spec: CredentialSpecData): SQLFragment {
  switch (spec.type) {
    case "ByToken":
      return sql`token_sha256=${spec.digest}`;
  }
}
