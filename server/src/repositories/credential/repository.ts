import type { Credential } from "../../models/credential";
import type { DbReadCtx } from "../common/capability";

/** Credentials are issued by the host; the application only verifies them. */
export interface ICredentialRepository {
  get(ctx: DbReadCtx, spec: Credential.Spec): Promise<Credential | null>;
}
