import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql } from "../../../infra/db";
import { dashboard, filter, monitor, panel } from "../../../models/console";
import {
  listEvents,
  overview,
  routes,
  series,
  traceDetails,
} from "../../../repositories/console";
import { saveConfiguration } from "../../../repositories/console/mcp";
import { publicProcedure as p, router } from "../init";

const windowInput = filter.extend({ end: z.iso.datetime() });
export const appRouter = router({
  overview: p
    .input(windowInput)
    .query(({ ctx, input }) => overview(ctx.db, input, new Date(input.end))),
  events: p
    .input(
      windowInput.extend({
        kind: z.enum(["log", "metric", "span"]),
        offset: z.number().int().min(0).max(1000000),
      }),
    )
    .query(({ ctx, input }) =>
      listEvents(ctx.db, input, input.kind, new Date(input.end), input.offset),
    ),
  routes: p
    .input(windowInput)
    .query(({ ctx, input }) => routes(ctx.db, input, new Date(input.end))),
  trace: p
    .input(z.string().regex(/^[a-f0-9]{32}$/))
    .query(({ ctx, input }) => traceDetails(ctx.db, input)),
  series: p
    .input(z.object({ panel, end: z.iso.datetime(), buckets: z.boolean() }))
    .query(({ ctx, input }) =>
      series(ctx.db, input.panel, new Date(input.end), input.buckets),
    ),
  dashboardLibrary: p.query(({ ctx }) =>
    ctx.db.queryAll<{
      definition: z.output<typeof dashboard>;
      version: string;
    }>(
      sql`SELECT definition,md5(definition::text) AS version FROM dashboards ORDER BY definition->>'title',id`,
    ),
  ),
  applyDashboard: p
    .input(
      z.object({
        definition: dashboard,
        expectedVersion: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const saved = await saveConfiguration(
        ctx.db,
        input.definition,
        input.expectedVersion,
      );
      if (!saved)
        throw new TRPCError({
          code: "CONFLICT",
          message: "別の編集が保存されました。最新の設定を開き直してください。",
        });
      return true;
    }),
  library: p.query(async ({ ctx }) => ({
    dashboards: await ctx.repos.dashboards.list(),
    monitors: await ctx.repos.monitors.list(),
    history: await ctx.repos.monitorHistory.list(),
    webhook: Boolean(process.env.MONITOR_WEBHOOK_URL),
  })),
  saveDashboard: p.input(dashboard).mutation(async ({ ctx, input }) => {
    await ctx.repos.dashboards.upsert(input);
    return true;
  }),
  saveMonitor: p.input(monitor).mutation(async ({ ctx, input }) => {
    if (input.notify && !process.env.MONITOR_WEBHOOK_URL)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "通知先が設定されていません",
      });
    await ctx.repos.monitors.upsert(input);
    return true;
  }),
  remove: p
    .input(z.object({ kind: z.enum(["dashboard", "monitor"]), id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const repo =
        input.kind === "dashboard" ? ctx.repos.dashboards : ctx.repos.monitors;
      return (await repo.delete(input.id)) > 0;
    }),
});
export type AppRouter = typeof appRouter;
