import type { Dashboard, Monitor } from "../../../../shared/console";
import { sql } from "../../infra/db";
import type { Database } from "../../infra/db/database";

export async function listConfiguration(db: Database) {
  const dashboards = await db.queryAll(
    sql`SELECT definition, md5(definition::text) AS version FROM dashboards ORDER BY definition->>'title', id`,
  );
  const monitors = await db.queryAll(
    sql`SELECT definition, md5(definition::text) AS version, state FROM monitors ORDER BY definition->>'title', id`,
  );
  return {
    dashboards,
    monitors,
    webhookConfigured: Boolean(process.env.MONITOR_WEBHOOK_URL),
  };
}

export function saveConfiguration(
  db: Database,
  item: Dashboard | Monitor,
  expected: string | null,
) {
  const isMonitor = "panel" in item;
  const table = isMonitor ? sql`monitors` : sql`dashboards`;
  const value = JSON.stringify(item);
  const reset = isMonitor
    ? sql`, evaluated = CASE WHEN definition <> ${value}::jsonb THEN NULL ELSE evaluated END`
    : sql``;
  const stmt =
    expected === null
      ? sql`INSERT INTO ${table}(id,definition) VALUES (${item.id},${value}::jsonb) ON CONFLICT DO NOTHING`
      : sql`UPDATE ${table} SET definition=${value}::jsonb ${reset} WHERE id=${item.id} AND md5(definition::text)=${expected}`;
  return db.queryGet<{ version: string; definition: Dashboard | Monitor }>(
    sql`${stmt} RETURNING definition, md5(definition::text) AS version`,
  );
}
