import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defaults } from "../../../shared/console";
import { dashboard, monitor, panel } from "../models/panel";
import { listConfiguration } from "../usecases/configuration/list-configuration";
import { saveDashboard } from "../usecases/configuration/save-dashboard";
import { saveMonitor } from "../usecases/configuration/save-monitor";
import type { Context } from "../usecases/context";
import { appRouter } from "./trpc/routers";

const version = z
  .string()
  .regex(/^[a-f0-9]{32}$/)
  .nullable()
  .describe(
    "Use null to create a new UUID, or the version from list_configuration to replace the complete definition.",
  );
const readOnly = { readOnlyHint: true };
const webhookConfigured = () => Boolean(process.env.MONITOR_WEBHOOK_URL);
function result(value: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export function managementMcp(ctx: Context) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "yuniview", version: "1.0.0" });
    const fresh = () => ({ ...ctx, now: new Date() });
    const api = appRouter.createCaller(fresh());
    server.registerTool(
      "list_configuration",
      {
        description:
          "Read saved dashboard and monitor definitions with their edit versions, monitor states and notification availability.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () => {
        const listed = await listConfiguration(webhookConfigured()).run(
          fresh(),
        );
        return listed.ok ? result(listed.value) : failure(listed.error.message);
      },
    );
    server.registerTool(
      "list_fields",
      {
        description:
          "Read the field dictionary: each field's key, display name, description, unit, preferred display unit, kind (gauge or counter) and default aggregation, with what its sender said and what people set.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () => result(await api.fields()),
    );
    server.registerTool(
      "list_telemetry",
      {
        description:
          "Discover service names and available metrics in the last hour for panel filters.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () =>
        result(
          await api.overview({ ...defaults, end: new Date().toISOString() }),
        ),
    );
    server.registerTool(
      "preview_panel",
      {
        description:
          "Evaluate a dashboard or monitor query against recent telemetry before saving. A panel reads one kind of data within its window (minutes) and lists the values it measures. panel.data is request (server spans, one per handled request), span (every span), log, event (weighted application events), metric or daily (daily sets). panel.conditions narrow the rows: {field, values} for any-of membership, inclusive {field, min, max} bounds, or {field: 'text', contains} for a case-insensitive substring of a log body or a span or metric name. Fields are source, slot, revision, instance, workload, day, time:<seconds> and attr:<key>. Conditions across fields use AND. Time bounds are epoch milliseconds, day bounds are UTC midnight of the JST calendar date. panel.values is an ordered list of {agg, of, per?, mark?}. of names the fields the value is computed from: value (a span's duration, or an event's count), failed (whether a span failed), metric:<name>, set:<name> (a daily set) or dimensions such as source or attr:<key>. agg is count (of: []), sum, avg, min, max, p50, p95 or p99 for numbers, rate for a counter metric (per-second increase of each container's counter), ratio for failed (percent), distinct for dimensions (several dimensions count combinations), and daily for a daily set (distinct members per service and day, summed). per (for avg, min or max of a number) averages the field per minute and per those dimensions, adds the averages, then aggregates the sums: {agg: avg, of: [metric:memory.current], per: [slot]} totals memory across slots. Use list_fields for the names, units and kinds senders and people gave each field. Several values need display pivot with measure on a shelf; each value's cells carry the label <agg>(<of joined by commas>) on that shelf, followed by /<per> when per is set, and values[i].mark overrides the rendering of one value. Pivot panels return row (series), column, optional facet and value per cell. Row, column and series accept ordered field arrays, returning rowPath, columnPath and facetPath for compound keys. With pivot.mark=auto put measure on either axis and fields on the opposite axis. For daily buckets use day for JST midnight or time:86400 for UTC midnight. For shorter buckets pivot.timeZones maps the assigned time field to JST or UTC for display. panel.fieldUnits maps a value label to a display unit, converting between units of one family. Display units do not alter query values or monitor thresholds. Time fields produce lines, categories produce bars. Set pivot.mark to area, stacked_area, bar or line to select a mark explicitly. Use panel.styleDefaults with color, dash, width or shape indices for defaults across all series. Individual pivot.styleRules override these defaults. Use pivot.encoding fields color, dash, width and shape to map grouped field values to visual styles. Include each encoded field in the series or measure shelf. Daily sets support all panel formats with day (JST), source, and measure shelves.",
        inputSchema: z.object({ panel }),
        annotations: readOnly,
      },
      async ({ panel }) =>
        result({
          points: await api.series({
            panel,
            end: new Date().toISOString(),
            buckets: true,
          }),
        }),
    );
    async function save(
      item: z.output<typeof dashboard> | z.output<typeof monitor>,
      expected: string | null,
    ) {
      const saved = await ("panel" in item
        ? saveMonitor(item, webhookConfigured(), expected)
        : saveDashboard(item, expected)
      ).run(fresh());
      if (saved.ok && saved.value) return result(saved.value);
      if (!saved.ok && saved.error.code === "INVALID_INPUT")
        return failure("Monitor notifications require a configured webhook.");
      if (!saved.ok && saved.error.code !== "CONFLICT")
        return failure(saved.error.message);
      return failure(
        "The ID or edit version conflicts with the stored configuration. Read list_configuration before retrying.",
      );
    }
    server.registerTool(
      "save_dashboard",
      {
        description:
          "Create or replace a dashboard and its ordered panels. Preserve existing panels when editing.",
        inputSchema: z.object({
          definition: dashboard,
          expectedVersion: version,
        }),
      },
      ({ definition, expectedVersion }) => save(definition, expectedVersion),
    );
    server.registerTool(
      "save_monitor",
      {
        description:
          "Create or replace a threshold monitor including its panel, sample minimum, missing-data policy and optional notifications.",
        inputSchema: z.object({
          definition: monitor,
          expectedVersion: version,
        }),
      },
      ({ definition, expectedVersion }) => save(definition, expectedVersion),
    );
    return server;
  });
}
