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
import { publicProcedure as p, router } from "../init";

const windowInput = filter.extend({ end: z.iso.datetime() });
export const appRouter = router({
  dailyUsage: p.query(({ ctx }) =>
    ctx.db.queryAll<{
      day: string;
      source: string;
      kind: string;
      users: number;
    }>(
      sql`SELECT day::text,source,kind,count(*) FILTER (WHERE digest <> '')::int AS users FROM daily_visitors WHERE day BETWEEN (now() AT TIME ZONE 'Asia/Tokyo')::date-29 AND (now() AT TIME ZONE 'Asia/Tokyo')::date GROUP BY day,source,kind ORDER BY day DESC,source`,
    ),
  ),
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
