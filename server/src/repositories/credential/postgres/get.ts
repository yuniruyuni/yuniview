import type { Database } from "../../../infra/db/database";
import { sql } from "../../../infra/db/sql";
import { compToSQL } from "../../../infra/db/sql-helpers";
import type { Credential } from "../../../models/credential";
import { credentialSpecToSQL } from "./common";

export async function get(
  db: Database,
  spec: Credential.Spec,
): Promise<Credential | null> {
  return db.queryGet<Credential & Record<string, unknown>>(
    sql`SELECT token_sha256 AS "tokenSha256",source_id AS source,workload,slot FROM agent_credentials WHERE ${compToSQL(spec, credentialSpecToSQL)} LIMIT 1`,
  );
}
