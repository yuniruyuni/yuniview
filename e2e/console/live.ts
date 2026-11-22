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
    await form
      .getByRole("combobox", { name: "表示形式", exact: true })
      .selectOption("table");
    const details = form.getByRole("link", { name: "checkout blue の詳細" });
    await expect(details).toHaveAttribute("href", /source=checkout/);
    await expect(details).toHaveAttribute("href", /slot=blue/);
    await form.getByRole("button", { name: "行にフィールドを追加" }).dblclick();
    const picker = page.getByRole("dialog", { name: "行に追加" });
    await picker.getByRole("searchbox").fill("スロット");
    await picker.getByRole("button", { name: "スロット", exact: true }).click();
    await expect(
      form.locator(
        '.worksheet-shelves [data-drop="row"] .shelf-chip .drag-source',
      ),
    ).toHaveText(["サービス", "スロット"]);
    await expect(
      form.getByRole("link", { name: "checkout blue 合計 の詳細" }),
    ).toBeVisible();
    await form.getByRole("button", { name: "元に戻す" }).click();
    await expect(details).toBeVisible();
    await form.getByLabel("パネル名").fill("失敗率");
    await form
      .getByRole("combobox", { name: "指標", exact: true })
      .selectOption("errors");
    await form
      .getByRole("combobox", { name: "表示形式", exact: true })
      .selectOption("value");
    await form.getByRole("button", { name: "配置に戻る" }).click();
    await form.getByLabel("名前", { exact: true }).fill("Checkout SLO");
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
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("stacked_area");
  await form
    .getByRole("button", { name: "系列にフィールドを追加" })
    .press("Enter");
  await page
    .getByRole("dialog", { name: "系列に追加" })
    .getByRole("button", { name: "スロット", exact: true })
    .click();
  const svg = form.getByRole("img", { name: "全系列の積み上げ面グラフ" });
  await expect(
    svg.locator("polygon title").filter({ hasText: "観測合計 32 MiB" }),
  ).toHaveCount(2);
  await expect(
    svg.locator("polygon title").filter({ hasText: "観測合計 500 MiB" }),
  ).toHaveCount(1);
  await expect(
    svg.locator("polygon title").filter({ hasText: "観測合計 60 MiB" }),
  ).toHaveCount(2);
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Stacked memory");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Stacked memory" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("img", { name: "全系列の積み上げ面グラフ" })
      .locator("polygon"),
  ).toHaveCount(5);
});

test("drag previews, cancellation, field shelves and saved panel order", async ({
  page,
}) => {
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
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
    form.getByRole("combobox", { name: "表示形式", exact: true }),
  ).toHaveValue("auto");
  await expect(page).toHaveURL(/sheet=/);
  await expect(form.locator(".canvas-grid")).toHaveCount(0);
  const catalog = form.locator(".field-catalog");
  const row = form.locator('.worksheet-shelves [data-drop="row"]');
  await catalog
    .getByRole("button", { name: "メモリ使用量", exact: true })
    .dragTo(row);
  await expect(row.locator(".shelf-chip .drag-source")).toHaveText(
    "メモリ使用量",
  );
  await catalog
    .getByRole("button", { name: "CPU 使用時間（累積）", exact: true })
    .dragTo(row);
  await expect(
    row.getByRole("button", { name: "cpu.usage を外す" }),
  ).toBeVisible();
  await catalog
    .getByRole("button", { name: "サービス", exact: true })
    .dragTo(form.locator('.worksheet-shelves [data-drop="series"]'));
  for (const metric of ["メモリ使用量", "CPU 使用時間（累積）"]) {
    await form
      .getByRole("group", { name: metric, exact: true })
      .getByLabel("表示形式")
      .selectOption("table");
  }
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
  await form.getByLabel("名前", { exact: true }).fill("Drag studio");
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

test("compound row and column shelves preserve their hierarchy on save", async ({
  page,
  request,
}) => {
  const id = randomUUID();
  const panel = {
    ...blankPanel,
    id: randomUUID(),
    title: "Nested memory",
    measure: "metric",
    metric: "memory.current",
    display: "pivot",
    pivot: {
      row: ["source", "slot"],
      column: ["workload", "measure"],
      metrics: ["cpu.usage"],
    },
  };
  const saved = await request.post("/api/trpc/applyDashboard", {
    data: {
      definition: { id, title: "Hierarchy", panels: [panel] },
      expectedVersion: null,
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto("/#page=dashboards&dashboard=" + id);
  const table = page.locator(".pivot-scroll table");
  await expect(
    table.getByRole("rowheader", { name: "checkout" }),
  ).toHaveAttribute("rowspan", "2");
  await expect(
    table.getByRole("columnheader", { name: "app", exact: true }),
  ).toHaveAttribute("colspan", "2");
  await expect(table.getByRole("rowheader", { name: "green" })).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: "cpu.usage" }),
  ).toBeVisible();
  const cell = table.getByRole("link", {
    name: "checkout green app memory.current の詳細",
  });
  await expect(cell).toHaveAttribute("href", /slot=green/);
  await expect(cell).toHaveAttribute("href", /workload=app/);
  await page.getByRole("button", { name: "Nested memory を編集" }).click();
  const row = page.locator('.worksheet-shelves [data-drop="row"]');
  const chips = row.locator(".shelf-chip .drag-source");
  await chips.last().dragTo(chips.first());
  await expect(chips).toHaveText(["スロット", "サービス"]);
  await page.getByRole("button", { name: "ワークロード を列から外す" }).click();
  await page
    .locator(".field-catalog")
    .getByRole("button", { name: "リビジョン", exact: true })
    .dragTo(page.locator('.worksheet-shelves [data-drop="column"]'));
  await page.getByRole("button", { name: "配置に戻る" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hierarchy" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Nested memory を編集" }).click();
  await expect(chips).toHaveText(["スロット", "サービス"]);
  await expect(
    page.locator(
      '.worksheet-shelves [data-drop="column"] .shelf-chip .drag-source',
    ),
  ).toHaveText(["メモリ使用量", "リビジョン"]);
});

test("worksheet encodes time or categories on either axis and splits observed series tuples", async ({
  page,
  request,
}) => {
  const t = Math.floor(Date.now() / 60000) * 60000 - 180000;
  for (const [slot, revision] of [
    ["blue", "A"],
    ["blue", "B"],
    ["green", "B"],
  ]) {
    for (const [i, cpu] of [
      [0, 0],
      [1, 5000000],
      [2, 1000],
    ]) {
      const res = await request.post(
        `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
        {
          headers: {
            Authorization: `Bearer ${slot === "blue" ? process.env.CONSOLE_TOKEN : process.env.GREEN_TEST_TOKEN}`,
          },
          data: {
            id: randomUUID().replaceAll("-", ""),
            time: new Date(t + i * 10000).toISOString(),
            source: {
              service: "checkout",
              workload: "app",
              slot,
              revision,
              instance: "axis-test",
            },
            signal: "resources",
            payload: { cpuUsageUsec: cpu, memoryBytes: 1048576 * (i + 1) },
          },
        },
      );
      expect(res.status(), await res.text()).toBe(204);
    }
  }
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  const place = async (label: string, shelf: string) =>
    form
      .locator(".field-catalog")
      .getByRole("button", { name: label, exact: true })
      .dragTo(form.locator('.worksheet-shelves [data-drop="' + shelf + '"]'));
  await place("時刻（10秒）", "column");
  await place("CPU 使用率 (%)", "row");
  await place("メモリ使用量", "row");
  await place("スロット", "series");
  await place("リビジョン", "series");
  await form
    .locator(".field-catalog")
    .getByRole("button", { name: "インスタンス", exact: true })
    .dragTo(form.locator('[data-drop="filter"]'));
  const filterEditor = form.getByRole("region", {
    name: "インスタンス の条件",
  });
  await filterEditor.getByLabel("axis-test", { exact: true }).check();
  await filterEditor.getByRole("button", { name: "閉じる" }).click();
  const plot = form.locator(".worksheet-plot");
  await expect(
    plot.getByRole("img", { name: "系列別の折れ線グラフ" }),
  ).toBeVisible();
  await expect(plot.locator(".legend button")).toHaveCount(6);
  const memory = form.getByRole("group", { name: "メモリ使用量", exact: true });
  const cpu = form.getByRole("group", { name: "CPU 使用率 (%)", exact: true });
  const memFormat = memory.getByRole("combobox", {
      name: "表示形式",
      exact: true,
    }),
    cpuFormat = cpu.getByRole("combobox", { name: "表示形式", exact: true });
  await memFormat.selectOption("bar");
  await cpuFormat.selectOption("line");
  await expect(plot.getByRole("img", { name: "複合グラフ" })).toBeVisible();
  await expect(plot.locator("rect")).toHaveCount(9);
  await expect(plot.locator("path")).toHaveCount(3);
  await memory.getByRole("combobox", { name: "集計" }).selectOption("max");
  await cpu.getByRole("combobox", { name: "集計" }).selectOption("min");
  await memFormat.selectOption("stacked_area");
  await cpuFormat.selectOption("stacked_area");
  await expect(
    form.getByText("積み上げ面には同じ単位の指標を配置してください。"),
  ).toBeVisible();
  await cpuFormat.selectOption("line");
  await memFormat.selectOption("line");
  await expect(plot.locator(".legend")).toContainText(
    "スロット=green · リビジョン=B",
  );
  await expect(
    plot.locator("circle title").filter({ hasText: "50 %" }),
  ).toHaveCount(3);
  await expect(
    plot.locator("circle title").filter({ hasText: "CPU 使用率" }),
  ).toHaveCount(3);
  await memFormat.selectOption("auto");
  await cpuFormat.selectOption("auto");
  await form.getByRole("button", { name: "時刻（10秒） を列から外す" }).click();
  await place("ワークロード", "column");
  await expect(
    plot.getByRole("img", { name: "カテゴリ別の棒グラフ" }),
  ).toBeVisible();
  await place("ワークロード", "row");
  await form
    .locator('[data-drop="row"] .shelf-chip .drag-source')
    .filter({ hasText: "メモリ使用量" })
    .dragTo(form.locator('.worksheet-shelves [data-drop="column"]'));
  await expect(plot).toContainText("横軸 指標");
  await expect(plot.locator("rect")).toHaveCount(6);
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Axis chart");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Axis chart", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".worksheet-plot rect")).toHaveCount(6);
  await expect(
    page.locator("rect title").filter({ hasText: "3,145,728" }),
  ).toHaveCount(3);
  await page.locator("button.panel-title").first().click();
  await expect(memory.getByRole("combobox", { name: "集計" })).toHaveValue(
    "max",
  );
  await expect(cpu.getByRole("combobox", { name: "集計" })).toHaveValue("min");
  await expect(
    form.getByRole("combobox", { name: "期間", exact: true }),
  ).toHaveCount(1);
  await expect(form.locator(".worksheet-shelves select")).toHaveCount(0);
});

test("worksheet shows only panel controls and fits inside the viewport", async ({
  page,
}) => {
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await expect(page.getByRole("heading", { name: "パネル編集" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ダッシュボード", exact: true }),
  ).toHaveCount(0);
  await expect(form.getByLabel("名前", { exact: true })).toHaveCount(0);
  await expect(
    form.getByRole("button", { name: "保存", exact: true }),
  ).toHaveCount(0);
  for (const [width, height] of [
    [1280, 720],
    [375, 667],
  ]) {
    await page.setViewportSize({ width, height });
    for (const element of [
      form.getByRole("button", { name: "配置に戻る", exact: true }),
      form.locator(".field-catalog"),
      form.locator(".worksheet-shelves"),
      form.locator(".builder-main > .card"),
    ]) {
      await expect(element).toBeInViewport({ ratio: 1 });
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await form.getByRole("button", { name: "設定", exact: true }).click();
  await form
    .getByRole("combobox", { name: "期間", exact: true })
    .selectOption("15");
  await form.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(
    form.getByRole("button", { name: "設定", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

test("filter shelf combines observed choices with numeric and time ranges before aggregation", async ({
  page,
}) => {
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor"),
    catalog = form.locator(".field-catalog"),
    shelf = form.locator('[data-drop="filter"]');
  await form
    .getByRole("combobox", { name: "指標", exact: true })
    .selectOption("requests");
  await form
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("value");
  await catalog
    .getByRole("button", { name: "http.response.status_code", exact: true })
    .dragTo(shelf);
  const code = form.getByRole("region", {
    name: "http.response.status_code の条件",
  });
  await code.getByLabel("下限").fill("504");
  await code.getByRole("button", { name: "範囲を適用" }).click();
  await expect(form.locator(".builder-main .empty")).toBeVisible();
  await code.getByLabel("下限").fill("503");
  await code.getByLabel("上限").fill("503");
  await code.getByRole("button", { name: "範囲を適用" }).click();
  await expect(form.locator(".values strong")).toHaveText("1");
  await code.getByRole("button", { name: "閉じる" }).click();
  await catalog
    .getByRole("button", { name: "http.route", exact: true })
    .dragTo(shelf);
  await form.getByRole("checkbox", { name: "/pay", exact: true }).check();
  await form
    .getByRole("region", { name: "http.route の条件" })
    .getByRole("button", { name: "閉じる" })
    .click();
  await catalog
    .getByRole("button", { name: "時刻（1秒）", exact: true })
    .dragTo(shelf);
  const time = form.getByRole("region", { name: "時刻（1秒） の条件" });
  await expect(time.getByLabel("上限")).toHaveAttribute(
    "type",
    "datetime-local",
  );
  await time.getByLabel("上限").fill("2000-01-01T00:00");
  await time.getByRole("button", { name: "範囲を適用" }).click();
  await expect(form.locator(".builder-main .empty")).toBeVisible();
  await form
    .getByRole("button", { name: "時刻（1秒） のフィルターを外す" })
    .click();
  await expect(form.locator(".values strong")).toHaveText("1");
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Filtered requests");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Filtered requests" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".values strong")).toHaveText("1");
  await page.locator("button.panel-title").first().click();
  await expect(
    page.getByRole("button", { name: "http.route · /pay", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "http.response.status_code · 503 ～ 503",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("上限")).toHaveValue("503");
});

test("log body is a literal free-text filter, independent of grouping", async ({
  page,
  request,
}) => {
  const term = "ReTrY 50%_";
  const t = new Date(Date.now() - 5000).toISOString();
  const source = {
    service: "checkout",
    workload: "app",
    slot: "blue",
    instance: "body-search",
    revision: "body-search",
  };
  const r = await request.post(
    `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
    {
      headers: { Authorization: `Bearer ${process.env.CONSOLE_TOKEN}` },
      data: {
        id: randomUUID().replaceAll("-", ""),
        time: t,
        source,
        signal: "logs",
        payload: {
          resourceLogs: [
            {
              scopeLogs: [
                {
                  logRecords: [
                    { body: { stringValue: "will retry 50%_ now" } },
                    { body: { stringValue: "will retry 500 now" } },
                    { severityText: term, body: { stringValue: "unrelated" } },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  );
  expect(r.status()).toBe(204);
  await page.goto("/#page=dashboards&revision=body-search");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor"),
    catalog = form.locator(".field-catalog");
  const log = catalog.getByRole("button", { name: "ログ", exact: true });
  await expect(log).toBeDisabled();
  await form
    .getByRole("combobox", { name: "指標", exact: true })
    .selectOption("logs");
  await form
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("value");
  await expect(form.locator(".values strong")).toHaveText("3");
  await log.dragTo(form.locator('[data-drop="series"]'));
  await expect(
    form.getByRole("combobox", { name: "表示形式", exact: true }),
  ).toHaveValue("value");
  await log.dragTo(form.locator('[data-drop="filter"]'));
  const editor = form.getByRole("region", { name: "ログ の条件" });
  await editor.getByLabel("本文に含む文字列").fill(term);
  await editor.getByLabel("本文に含む文字列").press("Enter");
  await expect(form.locator(".values strong")).toHaveText("1");
  await editor.getByRole("button", { name: "閉じる" }).click();
  await form
    .getByRole("button", { name: "列にフィールドを追加", exact: true })
    .dblclick();
  const picker = page.getByRole("dialog");
  await expect(
    picker.getByRole("button", { name: "ログ", exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "閉じる" }).click();
  await form.getByRole("button", { name: "配置に戻る" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Literal log filter");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Literal log filter" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".values strong")).toHaveText("1");
  const boardUrl = page.url();
  await page.getByRole("link", { name: "調査", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "will retry 50%_ now", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "unrelated", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "本文条件を外す" }).click();
  await expect(
    page.getByRole("cell", { name: "unrelated", exact: true }),
  ).toBeVisible();
  await page.goto(boardUrl);
  await page.locator("button.panel-title").first().click();
  await form.getByRole("button", { name: "ログ のフィルターを外す" }).click();
  await expect(form.locator(".values strong")).toHaveText("3");
});
