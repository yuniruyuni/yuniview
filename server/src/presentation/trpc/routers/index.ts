import { z } from "zod";
import {
  dashboard,
  filter,
  filterField,
  monitor,
  panel,
} from "../../../models/panel";
import { getLibrary } from "../../../usecases/configuration/get-library";
import { remove } from "../../../usecases/configuration/remove";
import { saveDashboard } from "../../../usecases/configuration/save-dashboard";
import { saveMonitor } from "../../../usecases/configuration/save-monitor";
import { getOverview } from "../../../usecases/console/get-overview";
import { getSeries } from "../../../usecases/console/get-series";
import { getTrace } from "../../../usecases/console/get-trace";
import { listAttributes } from "../../../usecases/console/list-attributes";
import { listEvents } from "../../../usecases/console/list-events";
import { listFilterOptions } from "../../../usecases/console/list-filter-options";
import { listRoutes } from "../../../usecases/console/list-routes";
import { handleResult } from "../handle-result";
import { publicProcedure as p, router } from "../init";

const notificationsAvailable = () => Boolean(process.env.MONITOR_WEBHOOK_URL);
const windowInput = filter.extend({ end: z.iso.datetime() });
const kind = z.enum(["metric", "log", "span", "event"]);
const eventCursor = z.object({
  at: z.string().max(64),
  source: z.string().max(512),
  batchId: z.string().max(512),
  ordinal: z.string().regex(/^\d{1,9}$/),
});
export const appRouter = router({
  worksheetFilterOptions: p
    .input(
      z.object({
        panel,
        field: filterField,
        end: z.iso.datetime(),
        search: z.string().max(512),
      }),
    )
    .query(({ ctx, input }) =>
      listFilterOptions(
        input.panel,
        input.field,
        new Date(input.end),
        input.search,
      )
        .run(ctx)
        .then(handleResult),
    ),
  worksheetAttributes: p
    .input(
      z.object({
        source: z.string().max(512),
        kind,
        metric: z.string().max(512),
        end: z.iso.datetime(),
        minutes: z.number().int().min(1).max(43200),
      }),
    )
    .query(({ ctx, input }) =>
      listAttributes({ ...input, end: new Date(input.end) })
        .run(ctx)
        .then(handleResult),
    ),
  overview: p
    .input(windowInput)
    .query(({ ctx, input }) =>
      getOverview(input, new Date(input.end)).run(ctx).then(handleResult),
    ),
  events: p
    .input(
      windowInput.extend({
        kind,
        conditions: panel.shape.conditions,
        logContains: filter.shape.text.optional(),
        after: eventCursor.optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listEvents(input, new Date(input.end), input.after)
        .run(ctx)
        .then(handleResult),
    ),
  routes: p
    .input(windowInput)
    .query(({ ctx, input }) =>
      listRoutes(input, new Date(input.end)).run(ctx).then(handleResult),
    ),
  trace: p
    .input(z.string().regex(/^[a-f0-9]{32}$/))
    .query(({ ctx, input }) => getTrace(input).run(ctx).then(handleResult)),
  series: p
    .input(z.object({ panel, end: z.iso.datetime(), buckets: z.boolean() }))
    .query(({ ctx, input }) =>
      getSeries(input.panel, new Date(input.end), input.buckets)
        .run(ctx)
        .then(handleResult),
    ),
  dashboardLibrary: p.query(
    async ({ ctx }) =>
      (await getLibrary(notificationsAvailable()).run(ctx).then(handleResult))
        .versionedDashboards,
  ),
  applyDashboard: p
    .input(
      z.object({
        definition: dashboard,
        expectedVersion: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      handleResult(
        await saveDashboard(input.definition, input.expectedVersion).run(ctx),
      );
      return true;
    }),
  library: p.query(async ({ ctx }) => {
    const { versionedDashboards: _, ...library } = handleResult(
      await getLibrary(notificationsAvailable()).run(ctx),
    );
    return library;
  }),
  saveDashboard: p.input(dashboard).mutation(async ({ ctx, input }) => {
    handleResult(await saveDashboard(input).run(ctx));
    return true;
  }),
  saveMonitor: p.input(monitor).mutation(async ({ ctx, input }) => {
    handleResult(await saveMonitor(input, notificationsAvailable()).run(ctx));
    return true;
  }),
  remove: p
    .input(z.object({ kind: z.enum(["dashboard", "monitor"]), id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      remove(input.kind, input.id).run(ctx).then(handleResult),
    ),
});
export type AppRouter = typeof appRouter;
