import { expect, test } from "@playwright/test";
import { blankPanel, defaults } from "../../shared/console";

test("MCP edits share console storage and reject stale versions", async ({
  request,
}) => {
  const base = process.env.CONSOLE_URL;
  const url = `${base}/mcp`;
  const headers = {
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
  };
  let sequence = 0;
  async function rpc(method: string, params: object = {}) {
    const response = await request.post(url, {
      headers,
      data: { jsonrpc: "2.0", id: ++sequence, method, params },
    });
    expect(response.ok()).toBe(true);
    const body = await response.text();
    const message = JSON.parse(
      body.startsWith("{")
        ? body
        : (body
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5) ?? ""),
    );
    expect(message.error).toBeUndefined();
    return message.result;
  }
  async function call(name: string, args: object = {}) {
    return rpc("tools/call", { name, arguments: args });
  }
  expect(
    (
      await rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      })
    ).serverInfo.name,
  ).toBe("yuniview");
  expect(
    (await rpc("tools/list")).tools.map((t: { name: string }) => t.name),
  ).toContain("save_monitor");
  expect(
    (
      await request.post(url, {
        headers: { ...headers, Origin: "https://untrusted.invalid" },
      })
    ).status(),
  ).toBe(403);
  const panel = { ...blankPanel, measure: "logs" };
  const config = {
    dashboard: { id: crypto.randomUUID(), title: "MCP panel", panels: [panel] },
    monitor: {
      id: crypto.randomUUID(),
      title: "MCP threshold",
      panel,
      operator: "above",
      threshold: 2,
      minimum: 1,
      missing: "no_data",
      notify: false,
    },
  };
  for (const kind of ["dashboard", "monitor"] as const) {
    const definition = config[kind];
    const saved = await call(`save_${kind}`, {
      definition,
      expectedVersion: null,
    });
    expect(saved.isError).toBeFalsy();
    const expectedVersion = JSON.parse(saved.content[0].text).version;
    const edited = {
      definition: { ...definition, title: `edited ${kind}` },
      expectedVersion,
    };
    expect((await call(`save_${kind}`, edited)).isError).toBeFalsy();
    expect((await call(`save_${kind}`, edited)).isError).toBe(true);
    const library = (
      await (await request.get(`${base}/api/trpc/library`)).json()
    ).result.data;
    expect(JSON.stringify(library[`${kind}s`])).toContain(`edited ${kind}`);
    await request.post(`${base}/api/trpc/remove`, {
      data: { kind, id: definition.id },
    });
  }
  for (const name of [
    "list_configuration",
    "list_telemetry",
    "preview_panel",
  ]) {
    expect(
      (await call(name, name === "preview_panel" ? { panel } : {})).isError,
    ).toBeFalsy();
  }
  const read = async (name: string, args: object = {}) => {
    const r = await call(name, args);
    expect(r.isError, `${name}: ${r.content?.[0]?.text}`).toBeFalsy();
    return JSON.parse(r.content[0].text);
  };
  // Exploring what is stored, as the explore page does.
  const query = { ...defaults, data: "log" };
  expect(await read("search_telemetry", { query })).toHaveProperty("items");
  await read("top_values", { query, field: "source" });
  await read("list_attributes", { query });
  await read("list_routes", { filter: defaults });
  await read("backtest_monitor", { monitor: config.monitor });
  expect((await call("get_trace", { trace: "z".repeat(32) })).isError).toBe(
    true,
  );

  // Saved configuration can be removed.
  const removable = {
    ...config.dashboard,
    id: crypto.randomUUID(),
    title: "MCP removable",
  };
  await read("save_dashboard", {
    definition: removable,
    expectedVersion: null,
  });
  expect(
    await read("remove_configuration", { kind: "dashboard", id: removable.id }),
  ).toEqual({ removed: true });

  // The field dictionary.
  const field = await read("save_field", {
    key: "attr:mcp.note",
    label: "MCP で付けた名前",
  });
  expect(JSON.stringify(field)).toContain("MCP で付けた名前");

  // Retention rules: preview, save, list, reorder and remove.
  const rule = (title: string) => ({
    id: crypto.randomUUID(),
    title,
    data: "metric",
    names: ["mcp.never.sent"],
    keep: 60,
  });
  const first = rule("MCP rule one");
  const second = rule("MCP rule two");
  expect(await read("preview_retention_rule", { rule: first })).toEqual({
    perDay: 0,
  });
  for (const r of [first, second])
    expect(await read("save_retention_rule", { rule: r })).toEqual({
      saved: true,
      perDay: 0,
    });
  const titles = async () =>
    (await read("list_retention_rules")).map(
      (r: { rule: { title: string } }) => r.rule.title,
    );
  expect(await titles()).toEqual(["MCP rule one", "MCP rule two"]);
  await read("reorder_retention_rules", { ids: [second.id, first.id] });
  expect(await titles()).toEqual(["MCP rule two", "MCP rule one"]);
  for (const r of [first, second])
    expect(await read("remove_retention_rule", { id: r.id })).toEqual({
      removed: true,
    });
  expect(await titles()).toEqual([]);
});
