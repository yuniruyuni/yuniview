import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";
import { blankPanel } from "../../shared/console";

test("agent records → trace and logs → saved panel → monitor and notification", async ({
  page,
  request,
}) => {
  const notices: string[] = [];
  const hook = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      notices.push(JSON.parse(data).state);
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) =>
    hook.listen(Number(process.env.HOOK_PORT), "127.0.0.1", resolve),
  );
  try {
    const trace = Buffer.from("0123456789abcdef").toString("base64");
    const span = Buffer.from("12345678").toString("base64");
    const time = new Date(Date.now() - 90000);
    const start = BigInt(+time) * 1000000n;
    const source = {
      service: "checkout",
      instance: "pod1",
      workload: "app",
      slot: "blue",
      revision: "abc",
    };
    const ingest = async (signal: string, payload: unknown) => {
      const res = await request.post(
        `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
        {
          headers: { Authorization: `Bearer ${process.env.CONSOLE_TOKEN}` },
          data: {
            id: randomUUID().replaceAll("-", ""),
            time: time.toISOString(),
            source,
            signal,
            payload,
          },
        },
      );
      expect(res.status(), await res.text()).toBe(204);
    };
    await ingest("traces", {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  name: "POST /pay",
                  kind: "SPAN_KIND_SERVER",
                  traceId: trace,
                  spanId: span,
                  startTimeUnixNano: String(start),
                  endTimeUnixNano: String(start + 240000000n),
                  attributes: [
                    { key: "http.route", value: { stringValue: "/pay" } },
                    {
                      key: "http.response.status_code",
                      value: { intValue: "503" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    await ingest("logs", {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  body: { stringValue: "upstream timeout" },
                  traceId: trace,
                  timeUnixNano: String(start),
                },
              ],
            },
          ],
        },
      ],
    });
    await ingest("logs", {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: ["order-a", "order-a", "order-b"].map((id) => ({
                body: { stringValue: "order" },
                timeUnixNano: String(start),
                attributes: [{ key: "order.id", value: { stringValue: id } }],
              })),
            },
          ],
        },
      ],
    });
    for (const [dataset, field, count] of [
      ["log", "order.id", 2],
      ["span", "http.route", 1],
    ] as const) {
      const panel = {
        ...blankPanel,
        measure: "distinct",
        distinct: { dataset, field },
        source: "checkout",
        group: "all",
        display: "value",
      };
      const result = await request.get("/api/trpc/series", {
        params: {
          input: JSON.stringify({
            panel,
            end: new Date().toISOString(),
            buckets: false,
          }),
        },
      });
      expect((await result.json()).result.data[0].value).toBe(count);
    }
    await ingest("resources", { cpuUsageUsec: 100, memoryBytes: 2048 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("row", { name: /checkout/ })).toContainText(
      "240",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "ログ", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "upstream timeout" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "トレース", exact: true }).click();
    await expect(page.getByText("checkout · POST /pay")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "関連ログ (1)" }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "メトリクス" })
      .click();
    await expect(
      page.getByRole("cell", { name: "memory.current", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "ダッシュボード" })
      .click();
    await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
    const form = page.locator("form.editor");
    await form.getByLabel("名前", { exact: true }).fill("Checkout SLO");
    await form
      .getByRole("combobox", { name: "表示", exact: true })
      .selectOption("pivot");
    const details = form.getByRole("link", { name: "checkout blue の詳細" });
    await expect(details).toHaveAttribute("href", /source=checkout/);
    await expect(details).toHaveAttribute("href", /slot=blue/);
    await form
      .getByRole("combobox", { name: "行", exact: true })
      .selectOption("slot");
    await expect(
      form.getByRole("combobox", { name: "列", exact: true }),
    ).toHaveValue("source");
    await expect(
      form.getByRole("link", { name: "blue checkout の詳細" }),
    ).toBeVisible();
    await form.getByRole("button", { name: "元に戻す" }).click();
    await expect(details).toBeVisible();
    await form.getByLabel("パネル名").fill("失敗率");
    await form
      .getByRole("combobox", { name: "指標", exact: true })
      .selectOption("errors");
    await form
      .getByRole("combobox", { name: "表示", exact: true })
      .selectOption("value");
    await form.getByRole("button", { name: "保存" }).click();
    await expect(
      page.getByRole("heading", { name: "Checkout SLO" }),
    ).toBeVisible();
    await expect(page.locator(".values strong")).toHaveText("100");
    await page.reload();
    await page.getByRole("button", { name: "モニター化" }).click();
    await form.getByLabel("名前", { exact: true }).fill("Checkout failures");
    await form.getByLabel("閾値").fill("50");
    await form.getByLabel("Webhook 通知").check();
    await form.getByRole("button", { name: "保存" }).click();
    await expect
      .poll(() => notices.includes("alert"), { timeout: 18000 })
      .toBe(true);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "モニター", exact: true })
      .click();
    await expect(page.locator(".state")).toHaveText("発報");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await form.getByLabel("閾値").fill("101");
    await form.getByRole("button", { name: "保存" }).click();
    await expect
      .poll(() => notices.includes("ok"), { timeout: 18000 })
      .toBe(true);
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await expect(page.locator(".state")).toHaveText("正常");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await form.getByLabel("最低サンプル数").fill("100");
    await form.getByRole("button", { name: "保存" }).click();
    await expect
      .poll(() => notices.includes("no_data"), { timeout: 18000 })
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    hook.closeAllConnections();
    hook.close();
  }
});

test("slot totals align gauge samples and exclude incomplete minutes", async ({
  request,
  page,
}) => {
  const end = Math.floor(Date.now() / 60000) * 60000;
  for (const [slot, minutesAgo, mib] of [
    ["blue", 3, 10],
    ["blue", 3, 14],
    ["green", 3, 20],
    ["blue", 2, 40],
    ["green", 2, 20],
    ["blue", 1, 500],
  ] as const) {
    const r = await request.post(
      `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
      {
        headers: {
          Authorization: `Bearer ${slot === "blue" ? process.env.CONSOLE_TOKEN : process.env.GREEN_TEST_TOKEN}`,
        },
        data: {
          id: randomUUID().replaceAll("-", ""),
          time: new Date(
            end - minutesAgo * 60000 + ((1000 * mib) % 60000),
          ).toISOString(),
          source: {
            service: "checkout",
            workload: "app",
            instance: slot,
            slot,
            revision: "total-test",
          },
          signal: "resources",
          payload: { memoryBytes: mib * 1048576 },
        },
      },
    );
    expect(r.status()).toBe(204);
  }
  const panel = {
    ...blankPanel,
    minutes: 5,
    revision: "total-test",
    measure: "metric",
    metric: "memory.current",
    unit: "MiB",
    group: "slot_total",
  };
  for (const [aggregation, buckets, expected] of [
    ["avg", true, [32, 60]],
    ["avg", false, [46]],
    ["max", false, [60]],
    ["min", false, [32]],
  ] as const) {
    const r = await request.get("/api/trpc/series", {
      params: {
        input: JSON.stringify({
          panel: { ...panel, aggregation },
          end: new Date(end).toISOString(),
          buckets,
        }),
      },
    });
    expect(
      (await r.json()).result.data.map((p: { value: number }) => p.value),
    ).toEqual(expected);
  }
  await page.goto("/#page=dashboards&revision=total-test");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form
    .getByRole("combobox", { name: "系列", exact: true })
    .selectOption("slot_total");
  await form
    .getByRole("combobox", { name: "表示", exact: true })
    .selectOption("value");
  await expect(form.locator(".values strong")).toHaveText("46");
});
