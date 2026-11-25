import type { Credential } from "../../../models/credential";
import type { DbReadCtx } from "../../common/capability";
import type { ICredentialRepository } from "../repository";
import { get } from "./get";

export class CredentialRepository implements ICredentialRepository {
  async get(ctx: DbReadCtx, spec: Credential.Spec): Promise<Credential | null> {
    return get(ctx.db, spec);
  }
}
