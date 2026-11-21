import type {
  Dashboard,
  Monitor,
  MonitorRow,
  Transition,
} from "../../../../shared/console";
import { sql } from "../../infra/db";
import type { DbReadCtx, DbWriteCtx } from "../common/capability";

export const dashboards = {
  async list({ db }: DbReadCtx) {
    const rows = await db.queryAll<{ definition: Dashboard }>(
      sql`SELECT definition FROM dashboards ORDER BY definition->>'title',id`,
    );
    return rows.map((row) => row.definition);
  },
  async upsert({ db }: DbWriteCtx, item: Dashboard) {
    await db.queryRun(sql`INSERT INTO dashboards(id,definition) VALUES(${item.id},${JSON.stringify(item)}::jsonb)
  ON CONFLICT(id) DO UPDATE SET definition=excluded.definition`);
  },
  async delete({ db }: DbWriteCtx, id: string) {
    return (await db.queryRun(sql`DELETE FROM dashboards WHERE id=${id}`))
      .rowCount;
  },
};
export const monitors = {
  list({ db }: DbReadCtx) {
    return db.queryAll<MonitorRow>(
      sql`SELECT definition,state,evaluated,value FROM monitors ORDER BY definition->>'title',id`,
    );
  },
  async upsert({ db }: DbWriteCtx, item: Monitor) {
    await db.queryRun(sql`INSERT INTO monitors(id,definition) VALUES(${item.id},${JSON.stringify(item)}::jsonb)
  ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,evaluated=NULL WHERE monitors.definition<>excluded.definition`);
  },
  async delete({ db }: DbWriteCtx, id: string) {
    return (await db.queryRun(sql`DELETE FROM monitors WHERE id=${id}`))
      .rowCount;
  },
};
export const monitorHistory = {
  list({ db }: DbReadCtx) {
    return db.queryAll<Transition>(
      sql`SELECT id,title,state,at,value,delivery FROM monitor_history ORDER BY created_at DESC,id LIMIT 100`,
    );
  },
};
