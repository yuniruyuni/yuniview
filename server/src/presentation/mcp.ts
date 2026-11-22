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
      "list_daily_usage",
      {
        description:
          "Read per-app counts of distinct logged-in accounts or browsers for each measured JST day in the past 30 days. Missing days are unmeasured.",
        inputSchema: z.object({}),
        annotations: readOnly,
      },
      async () => result({ days: await api.dailyUsage() }),
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
          "Evaluate a dashboard or monitor query against recent telemetry before saving.",
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
