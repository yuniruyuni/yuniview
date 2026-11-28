import { z } from "zod";
import type { Scope } from "../../../models/panel";
import {
  dashboard,
  fieldMeta,
  filter,
  filterField,
  monitor,
  panel,
  query,
  scope,
} from "../../../models/panel";
import { retentionRule } from "../../../models/retention";
import { getLibrary } from "../../../usecases/configuration/get-library";
import { remove } from "../../../usecases/configuration/remove";
import { saveDashboard } from "../../../usecases/configuration/save-dashboard";
import { saveMonitor } from "../../../usecases/configuration/save-monitor";
import { getOverview } from "../../../usecases/console/get-overview";
import { getRaw } from "../../../usecases/console/get-raw";
import { getSeries } from "../../../usecases/console/get-series";
import { getTrace } from "../../../usecases/console/get-trace";
import { listAttributes } from "../../../usecases/console/list-attributes";
import { listEvents } from "../../../usecases/console/list-events";
import { listFilterOptions } from "../../../usecases/console/list-filter-options";
import { listRoutes } from "../../../usecases/console/list-routes";
import { listTopValues } from "../../../usecases/console/list-top-values";
import { listFields } from "../../../usecases/dictionary/list-fields";
import { saveField } from "../../../usecases/dictionary/save-field";
import { backtest } from "../../../usecases/monitor/backtest";
import {
  listRules,
  previewRule,
  removeRule,
  reorderRules,
  saveRule,
} from "../../../usecases/retention/rules";
import { handleResult } from "../handle-result";
import { publicProcedure as p, router } from "../init";

const notificationsAvailable = () => Boolean(process.env.MONITOR_WEBHOOK_URL);
const end = z.iso.datetime();
const windowInput = filter.extend({ end });
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
        panel: scope,
        field: filterField,
        end,
        search: z.string().max(512),
      }),
    )
    .query(({ ctx, input }) =>
      listFilterOptions(
        input.panel as Scope,
        input.field,
        new Date(input.end),
        input.search,
      )
        .run(ctx)
        .then(handleResult),
    ),
  topValues: p
    .input(z.object({ query, field: filterField, end }))
    .query(({ ctx, input }) =>
      listTopValues(input.query, input.field, new Date(input.end))
        .run(ctx)
        .then(handleResult),
    ),
  worksheetAttributes: p
    .input(query.extend({ metric: z.string().max(512).optional(), end }))
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
      query.extend({
        data: z.enum(["request", "span", "log", "event", "metric"]),
        end,
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
  rawRow: p
    .input(
      z.object({
        source: z.string().max(512),
        batchId: z.string().max(512),
        ordinal: z.number().int().min(0).max(1e9),
      }),
    )
    .query(({ ctx, input }) =>
      getRaw({ source: input.source, id: input.batchId }, input.ordinal)
        .run(ctx)
        .then(handleResult),
    ),
  series: p
    .input(z.object({ panel, end, buckets: z.boolean() }))
    .query(({ ctx, input }) =>
      getSeries(input.panel, new Date(input.end), input.buckets)
        .run(ctx)
        .then(handleResult),
    ),
  fields: p.query(({ ctx }) => listFields().run(ctx).then(handleResult)),
  saveField: p.input(fieldMeta).mutation(({ ctx, input }) => {
    const { key, ...patch } = input;
    return saveField(key, patch).run(ctx).then(handleResult);
  }),
  backtest: p
    .input(z.object({ monitor, end }))
    .query(({ ctx, input }) =>
      backtest(input.monitor, new Date(input.end)).run(ctx).then(handleResult),
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
  retentionRules: p.query(({ ctx }) => listRules().run(ctx).then(handleResult)),
  previewRetentionRule: p
    .input(retentionRule)
    .query(({ ctx, input }) => previewRule(input).run(ctx).then(handleResult)),
  saveRetentionRule: p
    .input(retentionRule)
    .mutation(({ ctx, input }) => saveRule(input).run(ctx).then(handleResult)),
  removeRetentionRule: p
    .input(z.object({ id: z.uuid() }))
    .mutation(({ ctx, input }) =>
      removeRule(input.id).run(ctx).then(handleResult),
    ),
  reorderRetentionRules: p
    .input(z.object({ ids: z.array(z.uuid()).max(1000) }))
    .mutation(({ ctx, input }) =>
      reorderRules(input.ids).run(ctx).then(handleResult),
    ),
});
export type AppRouter = typeof appRouter;
