import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defaults } from "../../../shared/console";
import {
  dashboard,
  fieldMeta,
  filter,
  filterField,
  monitor,
  panel,
  query,
} from "../models/panel";
import { retentionRule } from "../models/retention";
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
// Deletes stored rows or configuration that cannot be brought back.
const destructive = { destructiveHint: true };
const conditionHelp =
  "Conditions are the same as preview_panel's panel.conditions.";
const webhookConfigured = () => Boolean(process.env.MONITOR_WEBHOOK_URL);
function result(value: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}
/** The tool's result, or its error as the tool's failure. */
async function attempt(fn: () => Promise<object>) {
  try {
    return result(await fn());
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error));
  }
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
    const now = () => new Date().toISOString();

    // Exploring stored rows, as the console's explore page does.
    server.registerTool(
      "search_telemetry",
      {
        description: `Read stored rows, newest first, 100 per page: requests (server spans), spans, logs, application events or metric readings within the last minutes. ${conditionHelp} Pass the returned cursor as after for the next page. Each row has its trace ID, which get_trace opens.`,
        inputSchema: z.object({
          query: query.extend({
            data: z.enum(["request", "span", "log", "event", "metric"]),
          }),
          after: z
            .object({
              at: z.string(),
              source: z.string(),
              batchId: z.string(),
              ordinal: z.string(),
            })
            .optional(),
        }),
        annotations: readOnly,
      },
      ({ query, after }) =>
        attempt(() => api.events({ ...query, end: now(), after })),
    );
    server.registerTool(
      "get_trace",
      {
        description:
          "Read every span and log of one trace across services, in time order. Span attrs include the sending process under attrs.resource. Exceptions recorded on a span are logs of the trace.",
        inputSchema: z.object({ trace: z.string().regex(/^[a-f0-9]{32}$/) }),
        annotations: readOnly,
      },
      ({ trace }) => attempt(() => api.trace(trace)),
    );
    server.registerTool(
      "get_raw_row",
      {
        description: `Read what one row (from search_telemetry or get_trace: its source, batchId and ordinal) was decoded from, as delivered: for a span, the OTLP span with its resource and scope, including what rows do not carry (links, status, flags). Payloads are kept for some days after delivery; after that, expired is true.`,
        inputSchema: z.object({
          source: z.string(),
          batchId: z.string(),
          ordinal: z.number().int().min(0),
        }),
        annotations: readOnly,
      },
      (row) => attempt(() => api.rawRow(row)),
    );
    server.registerTool(
      "top_values",
      {
        description: `The most frequent values of one field among the rows a query reads, with their counts. Fields are as in preview_panel (source, slot, revision, instance, workload, attr:<key>, ...). ${conditionHelp}`,
        inputSchema: z.object({ query, field: filterField }),
        annotations: readOnly,
      },
      ({ query, field }) =>
        attempt(() => api.topValues({ query, field, end: now() })),
    );
    server.registerTool(
      "list_attributes",
      {
        description:
          "The attribute keys (attr:<key>) seen on recent rows a query reads, optionally of one metric.",
        inputSchema: z.object({
          query,
          metric: z.string().max(512).optional(),
        }),
        annotations: readOnly,
      },
      ({ query, metric }) =>
        attempt(() =>
          api.worksheetAttributes({ ...query, metric, end: now() }),
        ),
    );
    server.registerTool(
      "list_routes",
      {
        description:
          "Requests per service and route within the last minutes: counts, failures, p95 duration in ms and the slowest trace of each.",
        inputSchema: z.object({ filter }),
        annotations: readOnly,
      },
      ({ filter }) => attempt(() => api.routes({ ...filter, end: now() })),
    );
    server.registerTool(
      "backtest_monitor",
      {
        description:
          "Replay a monitor definition (as save_monitor takes it) over the past days to see when it would have alerted, before saving it.",
        inputSchema: z.object({ monitor }),
        annotations: readOnly,
      },
      ({ monitor }) => attempt(() => api.backtest({ monitor, end: now() })),
    );
    server.registerTool(
      "remove_configuration",
      {
        description:
          "Delete a saved dashboard or monitor by ID (from list_configuration). A monitor's state history goes with it.",
        inputSchema: z.object({
          kind: z.enum(["dashboard", "monitor"]),
          id: z.uuid(),
        }),
        annotations: destructive,
      },
      (input) => attempt(async () => ({ removed: await api.remove(input) })),
    );

    // The field dictionary.
    server.registerTool(
      "save_field",
      {
        description:
          "Set what people say about one field of the dictionary (key from list_fields): display name, description, unit, preferred display unit, kind (gauge or counter) and default aggregation. Omitted properties stay as they are; null clears one and falls back to what the sender said.",
        inputSchema: fieldMeta,
      },
      (input) =>
        attempt(async () => ({ field: (await api.saveField(input)) ?? null })),
    );

    // Retention rules.
    const ruleHelp =
      "Rules are checked in order and the first one a row matches decides how long it is kept; rows matching none are kept forever. A rule matches rows of one kind of data (data, optional), with one of the exact names (names, optional; e.g. metric names), meeting the conditions (optional; as in preview_panel). keep is in minutes, or null to keep forever, which also shields rows from later rules.";
    server.registerTool(
      "list_retention_rules",
      {
        description: `Read the retention rules in order, each with about how many rows per day it decides (over the last 24 hours, after earlier rules; estimated from 1% of the stored rows, within about a tenth for rules deciding many rows), and about how many rows per day no rule decides (unclaimedPerDay, kept forever). ${ruleHelp}`,
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      () => attempt(() => api.retentionRules()),
    );
    server.registerTool(
      "preview_retention_rule",
      {
        description: `About how many rows per day a rule would decide over the last 24 hours after the rules before it, estimated from 1% of the stored rows, without saving. A new rule is previewed at the end of the list. ${ruleHelp}`,
        inputSchema: z.object({ rule: retentionRule }),
        annotations: readOnly,
      },
      ({ rule }) =>
        attempt(async () => ({
          perDay: await api.previewRetentionRule(rule),
        })),
    );
    server.registerTool(
      "save_retention_rule",
      {
        description: `Create a rule at the end of the list, or replace the one with the same ID. Takes effect on rows already stored: rows older than keep that the rule decides are deleted within minutes and cannot be restored, so run preview_retention_rule first. ${ruleHelp}`,
        inputSchema: z.object({ rule: retentionRule }),
        annotations: destructive,
      },
      ({ rule }) =>
        attempt(async () => {
          const perDay = await api.previewRetentionRule(rule);
          await api.saveRetentionRule(rule);
          return { saved: true, perDay };
        }),
    );
    server.registerTool(
      "remove_retention_rule",
      {
        description:
          "Delete a retention rule by ID. Rows it decided fall to the later rules, or are kept forever; rows it already deleted stay deleted.",
        inputSchema: z.object({ id: z.uuid() }),
        annotations: destructive,
      },
      (input) =>
        attempt(async () => ({
          removed: await api.removeRetentionRule(input),
        })),
    );
    server.registerTool(
      "reorder_retention_rules",
      {
        description:
          "Put the retention rules in this order (every rule's ID, from list_retention_rules). Order decides which rule a row falls to, so this can delete rows an earlier position kept.",
        inputSchema: z.object({ ids: z.array(z.uuid()).max(1000) }),
        annotations: destructive,
      },
      (input) =>
        attempt(async () => {
          await api.reorderRetentionRules(input);
          return { reordered: true };
        }),
    );
    return server;
  });
}
