import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defaults } from "../../../shared/console";
import { dashboard, monitor, panel } from "../models/console";
import {
  listConfiguration,
  saveConfiguration,
} from "../repositories/console/mcp";
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
function result(value: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}
function failure(text: string) {
  return { isError: true, content: [{ type: "text" as const, text }] };
}

export function managementMcp(ctx: Context) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "yuniview", version: "1.0.0" });
    const api = appRouter.createCaller(ctx);
    server.registerTool(
      "list_configuration",
      {
        description:
          "Read saved dashboard and monitor definitions with their edit versions, monitor states and notification availability.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () => result(await listConfiguration(ctx.db)),
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
          "Evaluate a dashboard or monitor query against recent telemetry before saving. Pivot panels return row (series), column, optional facet and value per cell. Row, column and series accept ordered field arrays, returning rowPath, columnPath and facetPath for compound keys. With pivot.mark=auto put measure on either axis and fields on the opposite axis. Time fields time:1/10/60/300/3600/86400 (seconds) produce lines, categories produce bars. Set pivot.mark to stacked_area for a stacked area of all observed series in the same unit, or bar or line to select a mark explicitly. Use metric derived:cpu.percent for CPU percent of one core. Use attr:<key> to group by an observed scalar attribute, and measure as a shelf to compare metric names. Panel conditions accept {field,values} for any-of membership or inclusive {field,min,max} bounds. Time bounds are epoch milliseconds, day bounds are UTC midnight of the JST calendar date. Conditions across fields use AND. For distinct counts specify dataset and field. Daily sets support day/source pivots or daily charts grouped by source. For gauge totals use group slot_total and totalSlots (default blue and green). Each complete minute sums per-slot means.",
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
      if ("notify" in item && item.notify && !process.env.MONITOR_WEBHOOK_URL)
        return failure("Monitor notifications require a configured webhook.");
      const saved = await saveConfiguration(ctx.db, item, expected);
      return saved
        ? result(saved)
        : failure(
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
