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
    const end = new Date().toISOString();
    const attributes = await request.get("/api/trpc/worksheetAttributes", {
      params: {
        input: JSON.stringify({
          end,
          minutes: 60,
          source: "checkout",
          kind: "log",
          metric: "",
        }),
      },
    });
    expect((await attributes.json()).result.data).toContain("order.id");
    const pivot = {
      ...blankPanel,
      source: "checkout",
      measure: "logs",
      display: "pivot",
      text: "order",
      pivot: { row: "attr:order.id", column: "slot", series: "source" },
    };
    const cells = await request.get("/api/trpc/series", {
      params: { input: JSON.stringify({ panel: pivot, end, buckets: false }) },
    });
    expect((await cells.json()).result.data).toEqual([
      expect.objectContaining({
        series: "order-a",
        column: "blue",
        facet: "checkout",
        value: 2,
      }),
      expect.objectContaining({
        series: "order-b",
        column: "blue",
        facet: "checkout",
        value: 1,
      }),
    ]);
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
      .selectOption("axis/slot");
    await expect(
      form.getByRole("combobox", { name: "列", exact: true }),
    ).toHaveValue("axis/source");
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

test("drag previews, cancellation, field shelves and saved panel order", async ({
  page,
}) => {
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form.getByLabel("名前", { exact: true }).fill("Drag studio");
  await form.getByLabel("パネル名").fill("First");
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form.getByRole("button", { name: "＋ パネル追加" }).click();
  await form.getByLabel("パネル名").fill("Second");
  await form.getByRole("button", { name: "配置に戻る" }).click();
  const titles = form.locator(".canvas-grid article h3 .handle-text");
  const tiles = form.locator(".canvas-grid .panel-handle");
  await tiles
    .first()
    .evaluate((tile) =>
      tile.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  const a = await tiles.first().boundingBox(),
    b = await tiles.last().boundingBox();
  if (!a || !b) throw Error("Missing panels");
  await page.mouse.move(a.x + 20, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 20, { steps: 8 });
  await expect(titles).toHaveText(["Second", "First"]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(titles).toHaveText(["First", "Second"]);
  await tiles.first().dragTo(tiles.last());
  await expect(titles).toHaveText(["Second", "First"]);
  await expect(form.getByLabel("パネル名")).toHaveCount(0);
  await form.getByRole("button", { name: "First の設定" }).click();
  await expect(form.getByLabel("パネル名")).toHaveValue("First");
  await form
    .locator(".field-catalog")
    .getByRole("button", { name: "スロット", exact: true })
    .scrollIntoViewIfNeeded();
  const axis = await form
    .locator(".field-catalog")
    .getByRole("button", { name: "スロット", exact: true })
    .boundingBox();
  if (!axis) throw Error("Missing field");
  await page.mouse.move(axis.x + 10, axis.y + 10);
  await page.mouse.down();
  await page.mouse.move(axis.x + 22, axis.y + 10);
  const shelf = await form
    .locator('.worksheet-shelves [data-drop="column"]')
    .boundingBox();
  if (!shelf) throw Error("Missing pivot destination");
  await page.mouse.move(shelf.x + 10, shelf.y + 10);
  await expect(form.locator(".preview-head h4")).toContainText("列");
  await page.mouse.up();
  await expect(
    form.getByRole("combobox", { name: "表示", exact: true }),
  ).toHaveValue("pivot");
  await expect(page).toHaveURL(/sheet=/);
  await expect(form.locator(".canvas-grid")).toHaveCount(0);
  const catalog = form.locator(".field-catalog");
  const row = form.locator('.worksheet-shelves [data-drop="row"]');
  await catalog
    .getByRole("button", { name: "メモリ使用量", exact: true })
    .dragTo(row);
  await expect(
    form.getByRole("combobox", { name: "行", exact: true }),
  ).toHaveValue("metric/memory.current");
  await catalog
    .getByRole("button", { name: "CPU 使用時間（累積）", exact: true })
    .dragTo(row);
  await expect(
    row.getByRole("button", { name: "cpu.usage を外す" }),
  ).toBeVisible();
  await catalog
    .getByRole("button", { name: "サービス", exact: true })
    .dragTo(form.locator('.worksheet-shelves [data-drop="series"]'));
  await expect(
    form.getByRole("heading", { name: "サービス · checkout" }),
  ).toBeVisible();
  await expect(
    form.getByRole("rowheader", { name: "memory.current" }),
  ).toBeVisible();
  await expect(
    form.getByRole("rowheader", { name: "cpu.usage" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    form.getByRole("heading", { name: "サービス · checkout" }),
  ).toBeVisible();
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form
    .getByRole("button", { name: "＋ パネル追加" })
    .dragTo(tiles.first());
  await expect(titles).toHaveText(["メモリ使用量", "Second", "First"]);
  await tiles.first().focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(titles).toHaveText(["Second", "メモリ使用量", "First"]);
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Drag studio" }),
  ).toBeVisible();
  await expect(page.locator(".cards article h3")).toHaveText([
    "Second",
    "メモリ使用量",
    "First",
  ]);
  await page.getByRole("button", { name: "編集モード" }).click();
  await expect(
    form.getByRole("complementary", { name: "パネル設定" }),
  ).toHaveCount(0);
  await expect(form.locator(".canvas-grid article")).toHaveCount(3);
  await form.getByRole("button", { name: "全幅" }).first().click();
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".canvas-cell[data-wide] h3")).toHaveText("Second");
  await page.getByRole("button", { name: "編集モード" }).click();
  await tiles.first().dragTo(tiles.last());
  await form.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(page.locator(".canvas-grid h3").first()).toHaveText("Second");
});
