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
    // Old enough for the monitor's window, which ends after rows can arrive.
    const time = new Date(Date.now() - 180000);
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
    const checkout = [{ field: "source", values: ["checkout"] }];
    for (const [data, field, count] of [
      ["log", "attr:order.id", 2],
      ["span", "attr:http.route", 1],
    ] as const) {
      const panel = {
        ...blankPanel,
        data,
        values: [{ agg: "distinct", of: [field] }],
        conditions: checkout,
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
          data: "log",
          conditions: checkout,
        }),
      },
    });
    expect((await attributes.json()).result.data).toContain("order.id");
    const pivot = {
      ...blankPanel,
      data: "log",
      conditions: [...checkout, { field: "text", contains: "order" }],
      display: "pivot",
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
    await expect(
      page.locator(".service-row").filter({ hasText: "checkout" }),
    ).toContainText("240 ms");
    const nav = page.getByRole("navigation");
    await nav.getByRole("button", { name: "探索", exact: true }).click();
    const rows = page.locator("table.rows tbody tr");
    await rows.filter({ hasText: "upstream timeout" }).click();
    const detail = page.getByRole("complementary", { name: "行の詳細" });
    await detail.getByRole("button", { name: "トレースを開く" }).click();
    await expect(page.getByText("checkout · POST /pay")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "同じトレースのログ (1)" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "戻る", exact: true }).click();
    await page
      .getByRole("group", { name: "データ", exact: true })
      .getByRole("button", { name: "メトリクス", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: "memory.current", exact: true }).first(),
    ).toBeVisible();
    await nav.getByRole("button", { name: "ダッシュボード" }).click();
    await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
    const form = page.locator("form.editor");
    await form
      .getByRole("combobox", { name: "表示形式", exact: true })
      .selectOption("table");
    const details = form.getByRole("link", { name: "checkout blue の詳細" });
    await expect(details).toHaveAttribute("href", /page=explore/);
    await expect(details).toHaveAttribute("href", /checkout/);
    await expect(details).toHaveAttribute("href", /blue/);
    await form.getByRole("button", { name: "行にフィールドを追加" }).click();
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
      .getByRole("combobox", { name: "データ", exact: true })
      .selectOption("request");
    await form
      .locator(".field-catalog")
      .getByRole("button", { name: "失敗", exact: true })
      .click();
    await form
      .getByRole("combobox", { name: "表示形式", exact: true })
      .selectOption("value");
    await form.getByRole("button", { name: "セーブ" }).click();
    await form.getByLabel("名前", { exact: true }).fill("Checkout SLO");
    await form.getByRole("button", { name: "保存" }).click();
    await expect(
      page.getByRole("heading", { name: "Checkout SLO" }),
    ).toBeVisible();
    await expect(page.locator(".values strong")).toHaveText("100");
    await page.reload();
    await page.getByRole("button", { name: "モニター化" }).click();
    await form.getByLabel("パネル名").fill("Checkout failures");
    await expect(form.locator("line.threshold")).toBeAttached();
    await expect(form.locator(".backtest")).toContainText("発報");
    await form.getByRole("spinbutton", { name: /^閾値/ }).fill("50");
    await form.getByLabel("Webhook 通知").check();
    await form.getByRole("button", { name: "セーブ" }).click();
    await expect
      .poll(() => notices.includes("alert"), { timeout: 18000 })
      .toBe(true);
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await expect(page.locator(".state")).toHaveText("発報");
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await form.getByRole("spinbutton", { name: /^閾値/ }).fill("101");
    await form.getByRole("button", { name: "セーブ" }).click();
    await expect
      .poll(() => notices.includes("ok"), { timeout: 18000 })
      .toBe(true);
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await expect(page.locator(".state")).toHaveText("正常");
    // A week's window charts the most the console reads, 30 days, instead
    // of twelve windows the server would refuse.
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await form.getByLabel("評価窓（分）").fill("10080");
    await expect(form.locator("line.threshold")).toBeAttached();
    await expect(form).not.toContainText("too_big");
    await form.getByRole("button", { name: "キャンセル" }).click();
    await page.getByRole("button", { name: "編集", exact: true }).click();
    await form.getByLabel("最低サンプル数").fill("100");
    await form.getByRole("button", { name: "セーブ" }).click();
    await expect
      .poll(() => notices.includes("no_data"), { timeout: 18000 })
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    hook.closeAllConnections();
    hook.close();
  }
});

test("per-slot totals add each slot's minute average and stack by slot", async ({
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
  const conditions = [{ field: "revision", values: ["total-test"] }];
  const panel = {
    ...blankPanel,
    minutes: 5,
    data: "metric",
    conditions,
    group: "source",
  };
  // Each minute adds the slots' averages; minutes missing a slot add what came.
  for (const [agg, buckets, expected] of [
    ["avg", true, [32, 60, 500]],
    ["avg", false, [(32 + 60 + 500) / 3]],
    ["max", false, [500]],
    ["min", false, [32]],
  ] as const) {
    const r = await request.get("/api/trpc/series", {
      params: {
        input: JSON.stringify({
          panel: {
            ...panel,
            values: [{ agg, of: ["metric:memory.current"], per: ["slot"] }],
          },
          end: new Date(end).toISOString(),
          buckets,
        }),
      },
    });
    const values = (await r.json()).result.data.map(
      (p: { value: number }) => p.value / 1048576,
    );
    expect(values).toHaveLength(expected.length);
    for (const [i, v] of (values as number[]).entries())
      expect(v).toBeCloseTo(expected[i], 6);
  }
  const id = randomUUID();
  const saved = await request.post("/api/trpc/applyDashboard", {
    data: {
      definition: {
        id,
        title: "Stacked memory",
        panels: [
          {
            ...panel,
            id: randomUUID(),
            title: "Memory by slot",
            values: [{ agg: "avg", of: ["metric:memory.current"] }],
            display: "pivot",
            pivot: {
              row: "measure",
              column: "time:60",
              series: ["slot"],
              mark: "stacked_area",
              encoding: { color: "slot" },
            },
          },
        ],
      },
      expectedVersion: null,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(`/#page=dashboards&dashboard=${id}&minutes=5`);
  await page.getByRole("button", { name: "Memory by slot を編集" }).click();
  const form = page.locator("form.editor");
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
  await expect(
    form.locator(".worksheet-shelves > [data-drop] strong"),
  ).toHaveText(["横軸", "縦軸", "色"]);
  await expect(form.getByRole("group", { name: "固定スタイル" })).toHaveCount(
    0,
  );
  const format = form.getByRole("combobox", { name: "表示形式", exact: true });
  await format.selectOption("summary");
  await expect(
    form.getByRole("columnheader", { name: "値（MiB）" }),
  ).toBeVisible();
  const reading = form
    .locator(".builder-main table tbody tr")
    .first()
    .locator("td")
    .nth(1);
  const mib = Number((await reading.innerText()).replaceAll(",", ""));
  await form.locator('[data-drop="measure"] .shelf-chip button').click();
  await form
    .locator(".metric-menu:popover-open")
    .getByLabel("表示単位")
    .selectOption("KiB");
  await page.keyboard.press("Escape");
  await expect(
    form.getByRole("columnheader", { name: "値（KiB）" }),
  ).toBeVisible();
  expect(Number((await reading.innerText()).replaceAll(",", ""))).toBeCloseTo(
    mib * 1024,
    -1,
  );
  await form.locator('[data-drop="measure"] .shelf-chip button').click();
  await form
    .locator(".metric-menu:popover-open")
    .getByLabel("表示単位")
    .selectOption("MiB");
  await page.keyboard.press("Escape");
  await format.selectOption("stacked_area");
  await form.getByRole("button", { name: "色に属性を割り当て" }).click();
  await page
    .getByRole("dialog", { name: "色に追加" })
    .getByRole("button", { name: "スロット", exact: true })
    .click();
  await format.selectOption("area");
  const area = form.getByRole("img", { name: "全系列のエリアグラフ" });
  const entries = form.locator(".worksheet-plot .legend button[aria-pressed]");
  await expect(entries).toHaveText(["スロット=blue", "スロット=green"]);
  await entries.first().click();
  await expect(entries).toHaveText(["スロット=blue", "スロット=green"]);
  await entries.first().click();
  await expect(area.locator("polyline")).toHaveCount(2);
  const curves = await area
    .locator("polyline")
    .evaluateAll((lines) =>
      lines.map((line) =>
        Array.from((line as SVGPolylineElement).points, ({ x, y }) => [x, y]),
      ),
    );
  const target = await area.evaluate((svg, x) => {
    const point = new DOMPoint(x, 70).matrixTransform(
      (svg as SVGSVGElement).getScreenCTM()!,
    );
    return { x: point.x, y: point.y };
  }, curves[0][0][0]);
  await page.mouse.move(target.x, target.y);
  const tip = form.getByRole("tooltip");
  await expect(tip).toContainText("観測合計32 MiB");
  await expect(tip).toContainText("スロット=green20 MiB");
  await area.focus();
  await area.press("ArrowRight");
  await expect(tip).toContainText("観測合計60 MiB");
  await area.press("ArrowRight");
  await expect(tip).toContainText("スロット=green未観測");
  await area.press("Escape");
  await expect(tip).toHaveCount(0);
  const bands = await area
    .locator('polygon[fill-opacity="0.25"]')
    .evaluateAll((polygons) =>
      polygons.map((polygon) =>
        Array.from((polygon as SVGPolygonElement).points, ({ x, y }) => [x, y]),
      ),
    );
  for (const [i, curve] of curves.entries()) {
    expect(bands[i].slice(0, curve.length)).toEqual(curve);
    expect(bands[i]).toHaveLength(2 * curve.length);
  }
  // The second band starts exactly at the first band's cumulative line.
  expect(bands[1].slice(curves[1].length).reverse()).toEqual(
    curves[0].slice(0, curves[1].length),
  );
  await expect(
    area.locator("title").filter({ hasText: "観測合計 60 MiB" }),
  ).toHaveCount(2);
  await format.selectOption("stacked_area");
  await form.getByRole("button", { name: "セーブ" }).click();
  await expect(
    page.getByRole("heading", { name: "Stacked memory", exact: true }),
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
  request,
}) => {
  // Two readings of one container, so its CPU counter has a rate.
  for (const [ago, cpu] of [
    [120000, 1000000],
    [60000, 31000000],
  ]) {
    const r = await request.post(
      `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
      {
        headers: { Authorization: `Bearer ${process.env.CONSOLE_TOKEN}` },
        data: {
          id: randomUUID().replaceAll("-", ""),
          time: new Date(Date.now() - ago).toISOString(),
          source: {
            service: "checkout",
            workload: "app",
            instance: "drag-test",
            slot: "blue",
          },
          signal: "resources",
          payload: { cpuUsageUsec: cpu, memoryBytes: 4 * 1048576 },
        },
      },
    );
    expect(r.status()).toBe(204);
  }
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form.getByLabel("パネル名").fill("First");
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByRole("button", { name: "＋ パネル追加" }).click();
  await form.getByLabel("パネル名").fill("Second");
  await form.getByRole("button", { name: "セーブ" }).click();
  const titles = form.locator(".canvas-grid article h3 .handle-text");
  await form.getByRole("button", { name: "First の設定" }).click();
  await form.getByLabel("パネル名").fill("discard me");
  await page.reload();
  await form.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(titles).toHaveText(["First", "Second"]);
  await form.getByRole("button", { name: "＋ パネル追加" }).click();
  await form.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.reload();
  await expect(titles).toHaveText(["First", "Second"]);
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
  await expect(form.locator(".preview-head h4")).toContainText("横軸");
  await page.mouse.up();
  await expect(
    form.getByRole("combobox", { name: "表示形式", exact: true }),
  ).toHaveValue("line");
  await expect(page).toHaveURL(/sheet=/);
  await expect(form.locator(".canvas-grid")).toHaveCount(0);
  const catalog = form.locator(".field-catalog");
  const row = form.locator('.worksheet-shelves [data-drop="row"]');
  await form
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("metric");
  // A counter starts as its rate, as its sender asked.
  await expect(row.locator(".value-chip")).toHaveText(["CPU 時間増加率×"]);
  await catalog
    .getByRole("button", { name: "メモリ使用量", exact: true })
    .dragTo(row);
  await expect(row.locator(".value-chip .drag-source")).toHaveText([
    "CPU 時間",
    "メモリ使用量",
  ]);
  await expect(
    row.getByRole("button", { name: "メモリ使用量 を外す" }),
  ).toBeVisible();
  await form
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("table");
  await expect(
    form.getByRole("rowheader", { name: "メモリ使用量" }),
  ).toBeVisible();
  await expect(
    form.getByRole("rowheader", { name: "CPU 時間の増加率" }),
  ).toBeVisible();
  // Each value is shown in the unit its sender prefers.
  await expect(
    form.getByRole("cell").filter({ hasText: / MiB$/ }).first(),
  ).toBeVisible();
  await expect(
    form.getByRole("cell").filter({ hasText: / %$/ }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    form.getByRole("rowheader", { name: "メモリ使用量" }),
  ).toBeVisible();
  await form.getByRole("button", { name: "セーブ" }).click();
  await form
    .getByRole("button", { name: "＋ パネル追加" })
    .dragTo(tiles.first());
  await expect(titles).toHaveText(["リクエスト数", "Second", "First"]);
  await tiles.first().focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(titles).toHaveText(["Second", "リクエスト数", "First"]);
  await form.getByLabel("名前", { exact: true }).fill("Drag studio");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Drag studio", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cards article h3")).toHaveText([
    "Second",
    "リクエスト数",
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
  for (const slot of ["blue", "green"])
    for (const [ago, cpu] of [
      [120000, 1000000],
      [60000, 2000000],
    ]) {
      const r = await request.post(
        `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
        {
          headers: {
            Authorization: `Bearer ${slot === "blue" ? process.env.CONSOLE_TOKEN : process.env.GREEN_TEST_TOKEN}`,
          },
          data: {
            id: randomUUID().replaceAll("-", ""),
            time: new Date(Date.now() - ago).toISOString(),
            source: {
              service: "checkout",
              workload: "app",
              instance: `nested-${slot}`,
              slot,
            },
            signal: "resources",
            payload: { cpuUsageUsec: cpu, memoryBytes: 8 * 1048576 },
          },
        },
      );
      expect(r.status()).toBe(204);
    }
  const id = randomUUID();
  const panel = {
    ...blankPanel,
    id: randomUUID(),
    title: "Nested memory",
    data: "metric",
    values: [
      { agg: "avg", of: ["metric:memory.current"] },
      { agg: "rate", of: ["metric:cpu.usage"] },
    ],
    display: "pivot",
    pivot: {
      row: ["source", "slot"],
      column: ["workload", "measure"],
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
    table.getByRole("columnheader", { name: "CPU 時間の増加率" }),
  ).toBeVisible();
  const cell = table.getByRole("link", {
    name: "checkout green app メモリ使用量 の詳細",
  });
  await expect(cell).toHaveAttribute("href", /page=explore/);
  await expect(cell).toHaveAttribute("href", /green/);
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
  await page.getByRole("button", { name: "セーブ" }).click();
  await expect(
    page.getByRole("heading", { name: "Hierarchy", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Nested memory を編集" }).click();
  await expect(chips).toHaveText(["スロット", "サービス"]);
  await expect(
    page.locator(
      '.worksheet-shelves [data-drop="column"] .shelf-chip .drag-source',
    ),
  ).toHaveText(["メモリ使用量", "CPU 時間", "リビジョン"]);
  await page.getByLabel("パネル名").fill("cancelled name");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Nested memory を編集" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Nested memory を編集" }),
  ).toBeVisible();
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
      .dragTo(form.locator('[data-drop="' + shelf + '"]'));
  await place("時刻", "column");
  const catalog = form.locator(".field-catalog");
  await expect(
    catalog.getByRole("button", { name: "時刻", exact: true }),
  ).toHaveCount(1);
  await expect(catalog.getByRole("button", { name: /日付/ })).toHaveCount(0);
  const timeChip = form
    .locator('[data-drop="column"] .shelf-chip')
    .getByRole("button", { name: "時刻", exact: true });
  const grain = form.getByLabel("横軸の時刻の粒度");
  const zone = form.getByLabel("横軸のタイムゾーン");
  await timeChip.click();
  await grain.selectOption({ label: "1日" });
  await expect(zone).toHaveValue("JST");
  await page.reload();
  await timeChip.click();
  await expect(grain).toHaveValue("time:86400");
  await zone.selectOption("UTC");
  await expect(grain).toHaveValue("time:86400");
  await grain.selectOption("time:10");
  await page.reload();
  await timeChip.click();
  await expect(grain).toHaveValue("time:10");
  await expect(zone).toHaveValue("UTC");
  await page.keyboard.press("Escape");
  // A counter metric starts as its rate, in the unit its sender prefers.
  await form
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("metric");
  await expect(
    form.locator('[data-drop="row"] .value-chip .drag-source'),
  ).toHaveText(["CPU 時間"]);
  await place("メモリ使用量", "row");
  await place("スロット", "style-color");
  await place("リビジョン", "style-dash");
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
  await expect(plot.locator(".legend button[aria-pressed]")).toHaveCount(6);
  const utcClock = new Date(t).toISOString().slice(11, 19);
  await expect(
    plot
      .getByRole("img")
      .locator("title")
      .filter({ hasText: utcClock })
      .first(),
  ).toBeAttached();
  await timeChip.click();
  await zone.selectOption("JST");
  await page.keyboard.press("Escape");
  const jstClock = new Date(t + 9 * 3600000).toISOString().slice(11, 19);
  await expect(
    plot
      .getByRole("img")
      .locator("title")
      .filter({ hasText: jstClock })
      .first(),
  ).toBeAttached();

  const format = form.getByRole("combobox", { name: "表示形式", exact: true });
  await expect(format).toHaveCount(1);
  await format.selectOption("bar");
  await expect(
    form.locator('.worksheet-shelves [data-drop^="style-"]'),
  ).toHaveCount(1);
  const metricButton = form
    .locator(".shelf-chip button")
    .filter({ hasText: "メモリ使用量" })
    .first();
  const colorZone = form.locator('[data-drop="style-color"]');
  const before = await colorZone.boundingBox();
  await metricButton.click();
  const unit = form.locator(".metric-menu:popover-open").getByLabel("表示単位");
  await unit.selectOption("MiB");
  await expect(
    plot.getByRole("img").locator("title").filter({ hasText: "MiB" }).first(),
  ).toBeAttached();

  const control = await metricButton.boundingBox();
  const menu = await form.locator(".metric-menu:popover-open").boundingBox();
  if (!control || !menu) throw Error("Missing aggregation popup");
  // The value menu (units, aggregations, per-group totals, naming) is taller
  // than the room above or below the chip in a 720px viewport, so it may
  // cover the chip; it must still fit the viewport.
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 720,
  );
  expect(await colorZone.boundingBox()).toEqual(before);
  await form
    .locator(".metric-menu:popover-open")
    .getByRole("button", { name: "最大", exact: true })
    .click();
  await form
    .locator(".shelf-chip button")
    .filter({ hasText: "CPU 時間" })
    .first()
    .click();
  const cpuMenu = form.locator(".metric-menu:popover-open");
  await expect(cpuMenu.getByLabel("表示単位").locator("option")).toContainText([
    "%",
  ]);
  await expect(
    cpuMenu.getByRole("button", { name: "増加率", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await format.selectOption("stacked_area");
  await expect(
    form.getByText("積み上げ面には同じ単位の指標を配置してください。"),
  ).toBeVisible();
  await format.selectOption("line");
  await place("リビジョン", "style-dash");
  await expect(plot.locator(".legend")).toContainText(
    "スロット=green · リビジョン=B",
  );
  await expect(
    plot.locator("circle title").filter({ hasText: "50 %" }),
  ).toHaveCount(3);
  await expect(
    plot.locator("circle title").filter({ hasText: "CPU 時間の増加率" }),
  ).toHaveCount(3);
  const dialog = page.getByRole("dialog", { name: "凡例のスタイルを編集" });
  const editStyles = async (label: string) => {
    await form.getByRole("button", { name: "凡例のスタイルを編集" }).click();
    await dialog.getByRole("button", { name: label, exact: true }).click();
  };
  const constant = async (role: string, name: string) => {
    await editStyles(role);
    await dialog.getByLabel("全項目の割り当て").selectOption({ label: name });
    await dialog.getByRole("button", { name: "閉じる" }).click();
  };
  await constant("点の形", "三角");
  await form.getByRole("button", { name: "色に属性を割り当て" }).click();
  const colorDialog = page.getByRole("dialog", { name: "色に追加" });
  await expect(colorDialog.getByText("全系列に適用")).toHaveCount(0);
  await colorDialog
    .getByRole("button", { name: "スロット", exact: true })
    .click();
  await form.getByRole("button", { name: "色の割り当てを外す" }).click();
  await constant("線種", "破線");
  await constant("線の太さ", "太い");
  await expect(
    plot
      .getByRole("img")
      .locator('path[stroke-dasharray="7 4"][stroke-width="3.5"]'),
  ).toHaveCount(4);
  const styleShelves = form.getByRole("group", {
    name: "フィールドの割り当て",
    exact: true,
  });
  const assignStyle = async (field: string, channel: string) =>
    form
      .locator(".field-catalog")
      .getByRole("button", { name: field, exact: true })
      .dragTo(styleShelves.locator('[data-drop="style-' + channel + '"]'));
  await assignStyle("スロット", "color");
  await assignStyle("リビジョン", "dash");
  await assignStyle("スロット", "width");
  await form
    .getByRole("button", { name: "点の形に属性を割り当て" })
    .press("Enter");
  await page
    .getByRole("dialog", { name: "点の形に追加" })
    .getByRole("button", { name: "リビジョン", exact: true })
    .click();
  await expect(styleShelves.locator('[data-drop="style-shape"]')).toContainText(
    "リビジョン",
  );
  await styleShelves
    .getByRole("button", { name: "点の形の割り当てを外す" })
    .click();
  await expect(styleShelves.locator('[data-drop="style-shape"]')).toContainText(
    "三角",
  );
  await constant("線種", "自動");
  await constant("線の太さ", "自動");
  await constant("点の形", "自動");
  await assignStyle("スロット", "shape");
  await assignStyle("リビジョン", "shape");
  await expect(
    plot.getByRole("img").locator('path[stroke-dasharray="1 4"]'),
  ).toHaveCount(4);
  await expect(
    plot.getByRole("img").locator('path[stroke-width="1"]'),
  ).toHaveCount(4);
  await expect(plot.getByRole("img").locator("rect")).toHaveCount(8);
  const diagram = await plot.getByRole("img").boundingBox(),
    legend = await plot.locator(".legend").boundingBox();
  expect(legend!.x).toBeGreaterThanOrEqual(diagram!.x + diagram!.width - 1);
  await expect(
    plot.locator('.legend-key line[stroke-dasharray="1 4"]'),
  ).toHaveCount(4);
  await editStyles("点の形");
  const originalViewport = page.viewportSize()!;
  const rowGeometry = () =>
    dialog.locator(".legend-style-entry").evaluateAll((rows) =>
      rows.map((row) => {
        const label = row.querySelector("span")!;
        const text = document.createRange();
        text.selectNodeContents(label.lastChild!);
        return [row, text, row.querySelector("select")!].map((item) => {
          const { x, y, width, height } = item.getBoundingClientRect();
          return [x, y, width, height];
        });
      }),
    );
  const individual = dialog.getByLabel("B の個別指定");
  for (const viewport of [originalViewport, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    const before = await rowGeometry();
    await individual.selectOption({ label: "三角" });
    await expect(dialog.locator(".style-sample polygon")).toBeVisible();
    expect(await rowGeometry()).toEqual(before);
    await individual.selectOption({ label: "全項目に従う" });
    expect(await rowGeometry()).toEqual(before);
  }
  await page.setViewportSize(originalViewport);
  await individual.selectOption({ label: "三角" });
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(plot.getByRole("img").locator("polygon")).toHaveCount(8);
  await expect(plot.locator(".legend-key polygon")).toHaveCount(4);
  await expect(form.locator('[data-drop="filter"] select')).toHaveCount(0);
  await constant("点の形", "四角");
  await expect(plot.getByRole("img").locator("rect")).toHaveCount(4);
  await expect(plot.getByRole("img").locator("polygon")).toHaveCount(8);
  await expect(styleShelves.locator('[data-drop="style-shape"]')).toContainText(
    "リビジョン",
  );
  await page.reload();
  await editStyles("点の形");
  await expect(dialog.getByLabel("全項目の割り当て")).toHaveValue("1");
  await expect(dialog.getByLabel("B の個別指定")).toHaveValue("2");
  await dialog
    .getByLabel("B の個別指定")
    .selectOption({ label: "全項目に従う" });
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(plot.getByRole("img").locator("rect")).toHaveCount(12);
  await format.selectOption("auto");
  await form
    .getByRole("button", { name: "時刻（10秒） を横軸から外す" })
    .click();
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
  await expect(plot.getByRole("img").locator("rect")).toHaveCount(4);
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Axis chart");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Axis chart", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".worksheet-plot svg[role=img] rect")).toHaveCount(
    4,
  );
  await expect(
    page.locator("rect title").filter({ hasText: "3 MiB" }),
  ).toHaveCount(2);
  await page.locator("button.panel-title").first().click();
  await expect(form.locator(".worksheet-shelves")).toContainText("最大");
  await expect(form.locator(".worksheet-shelves")).toContainText("増加率");
  await expect(
    form.getByRole("button", { name: "ダッシュボードの期間" }),
  ).toBeVisible();
  await expect(form.locator('[data-drop="series"]')).toHaveCount(0);
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
  // An administration console used from a PC: no narrow layout.
  for (const [width, height] of [
    [1280, 720],
    [1600, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const header = form.locator(".worksheet-heading");
    const controls = await Promise.all(
      [
        header.getByRole("heading", { name: "パネル編集" }),
        header.getByRole("textbox", { name: "パネル名" }),
        header.getByRole("button", { name: "ダッシュボードの期間" }),
        header.getByRole("button", { name: "キャンセル" }),
        header.getByRole("button", { name: "セーブ" }),
        header.getByRole("button", { name: "パネル操作" }),
      ].map((control) => control.boundingBox()),
    );
    for (const i of [0, 2, 3, 4]) {
      const left = controls[i],
        right = controls[i + 1];
      if (!left || !right) throw Error("Missing worksheet header control");
      expect(left.x + left.width).toBeLessThanOrEqual(right.x);
      expect(left.y + left.height / 2).toBeCloseTo(
        right.y + right.height / 2,
        0,
      );
    }
    const format = await form.locator(".worksheet-format").boundingBox();
    const catalog = await form.locator(".field-catalog").boundingBox();
    const zones = await form
      .locator(".worksheet-shelves > [data-drop]")
      .evaluateAll((els) =>
        els.map((el) => {
          const { left, top, bottom, width } = el.getBoundingClientRect();
          return { left, top, bottom, width };
        }),
      );
    if (!format || !catalog || zones.length !== 6)
      throw Error("Missing worksheet controls");
    expect(format.x).toBeCloseTo(catalog.x);
    expect(format.y + format.height).toBeLessThanOrEqual(catalog.y);
    const filter = await form
      .locator(".assignment-pane .filter-shelf")
      .boundingBox();
    const preview = await form.locator(".builder-main").boundingBox();
    if (!filter || !preview) throw Error("Missing filter or preview");
    expect(filter.x).toBeCloseTo(zones[0].left);
    expect(filter.y + filter.height).toBeLessThanOrEqual(zones[0].top);
    expect(zones[0].left + zones[0].width).toBeLessThanOrEqual(catalog.x);
    expect(preview.x + preview.width).toBeLessThanOrEqual(filter.x);
    zones.slice(1).forEach((zone, i) => {
      expect(zone.left).toBeCloseTo(zones[0].left);
      expect(zone.width).toBeCloseTo(zones[0].width);
      expect(zone.top).toBeGreaterThanOrEqual(zones[i].bottom);
    });
    for (const element of [
      form.getByRole("button", { name: "セーブ", exact: true }),
      form.locator(".field-catalog"),
      form.locator(".assignment-pane"),
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
  const formatSelect = form.getByRole("combobox", {
    name: "表示形式",
    exact: true,
  });
  for (const format of ["summary", "value"]) {
    await formatSelect.selectOption(format);
    await form
      .locator(".field-catalog")
      .getByRole("button", { name: "所要時間", exact: true })
      .click();
    const value = form.locator('[data-drop="measure"]');
    const group = form.locator('[data-drop="group"]');
    await expect(value.locator(".shelf-target strong")).toHaveText("値");
    await expect(group.locator(".shelf-target strong")).toHaveText("分類");
    await value
      .locator(".shelf-chip")
      .getByRole("button", { name: "所要時間" })
      .click();
    await expect(
      form.locator(".metric-menu:popover-open").getByLabel("表示単位"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await group.getByRole("button", { name: "分類にフィールドを追加" }).click();
    await page
      .getByRole("dialog", { name: "分類に追加" })
      .getByRole("button", { name: "サービス", exact: true })
      .click();
    await expect(group.locator(".shelf-chip")).toContainText("サービス");
    await group.getByRole("button", { name: "分類の割り当てを外す" }).click();
    await expect(group.locator(".shelf-chip")).toHaveText("全体");
  }
  const range = form.getByRole("button", { name: "ダッシュボードの期間" });
  await range.click();
  await page.getByRole("button", { name: "直近15分", exact: true }).click();
  await expect(form.locator(".builder-main .card small").first()).toContainText(
    "15分",
  );
  await range.click();
  // The page header keeps its own (hidden) picker; use the one that opened.
  const picker = page.locator(".dashboard-time").filter({ visible: true });
  const days = picker.locator(".range-calendar button");
  await days.nth(1).click();
  await days.nth(3).click();
  await expect(days.nth(2)).toHaveAttribute("aria-pressed", "true");
  await picker.getByLabel("開始日", { exact: true }).fill("2026-03-01");
  await picker.getByLabel("終了日", { exact: true }).fill("2026-03-02");
  await picker.getByRole("button", { name: "範囲を適用" }).click();
  await expect(page).toHaveURL(/minutes=2880/);
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByRole("button", { name: "＋ パネル追加" }).click();
  await form.getByRole("button", { name: "セーブ" }).click();
  await expect(
    form.locator(".canvas-grid article small").filter({ hasText: "2880分" }),
  ).toHaveCount(2);
  await expect(range).toHaveText(/2026-03-01.*2026-03-02/);
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
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("request");
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
    .getByRole("button", { name: "時刻", exact: true })
    .dragTo(shelf);
  const time = form.getByRole("region", { name: "時刻 の条件" });
  await expect(time.getByLabel("上限")).toHaveAttribute(
    "type",
    "datetime-local",
  );
  await time.getByRole("button", { name: "日単位（JST）で指定" }).click();
  const dateFilter = form.getByRole("region", {
    name: "日付（JST） の条件",
  });
  await expect(dateFilter.getByLabel("上限")).toHaveAttribute("type", "date");
  await dateFilter.getByRole("button", { name: "日時で指定" }).click();
  await time.getByLabel("上限").fill("2000-01-01T00:00");
  await time.getByRole("button", { name: "範囲を適用" }).click();
  await expect(form.locator(".builder-main .empty")).toBeVisible();
  await form.getByRole("button", { name: "時刻 のフィルターを外す" }).click();
  await expect(form.locator(".values strong")).toHaveText("1");
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Filtered requests");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Filtered requests", exact: true }),
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

test("the text condition is a literal substring of a body or name, independent of grouping", async ({
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
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor"),
    catalog = form.locator(".field-catalog");
  const text = catalog.getByRole("button", { name: "本文・名前", exact: true });
  await form
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("log");
  await catalog
    .getByRole("button", { name: "リビジョン", exact: true })
    .dragTo(form.locator('[data-drop="filter"]'));
  const revision = form.getByRole("region", { name: "リビジョン の条件" });
  await revision.getByLabel("body-search", { exact: true }).check();
  await revision.getByRole("button", { name: "閉じる" }).click();
  const verifyCountAxis = async (name: string) => {
    const chart = form.getByRole("img", { name, exact: true });
    const labels = chart.locator(":scope > g > text");
    await expect(labels).toHaveText(["0", "1", "2", "3"]);
    const cy = Number(await chart.locator("circle").first().getAttribute("cy"));
    const grid = Number(
      await chart
        .locator(":scope > g")
        .filter({ has: page.locator("text", { hasText: /^3$/ }) })
        .locator("line")
        .getAttribute("y1"),
    );
    expect(cy).toBeCloseTo(grid);
  };
  await verifyCountAxis("集計値の推移");
  await catalog
    .getByRole("button", { name: "時刻", exact: true })
    .dragTo(form.locator('[data-drop="column"]'));
  await verifyCountAxis("系列別の折れ線グラフ");
  await form
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("value");
  await expect(
    form.locator(".worksheet-shelves > [data-drop] strong"),
  ).toHaveText(["値", "分類"]);
  await catalog
    .getByRole("button", { name: "サービス", exact: true })
    .dragTo(form.locator('[data-drop="group"]'));
  await expect(form.locator('[data-drop="group"]')).toContainText("サービス");
  await expect(form.locator(".values strong")).toHaveText("3");
  await expect(form.locator('[data-drop="column"]')).toHaveCount(0);
  await text.dragTo(form.locator('[data-drop="group"]'));
  await expect(
    form.getByRole("combobox", { name: "表示形式", exact: true }),
  ).toHaveValue("value");
  await text.dragTo(form.locator('[data-drop="filter"]'));
  const editor = form.getByRole("region", { name: "本文・名前 の条件" });
  await editor.getByLabel("本文・名前に含む文字列").fill(term);
  await editor.getByLabel("本文・名前に含む文字列").press("Enter");
  // "%" and "_" are literal, case is ignored, and a log's level is its name.
  await expect(form.locator(".values strong")).toHaveText("2");
  await editor.getByRole("button", { name: "閉じる" }).click();
  await form.locator('[data-drop="group"] button').first().click();
  const picker = page.getByRole("dialog");
  await expect(
    picker.getByRole("button", { name: "本文・名前", exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "閉じる" }).click();
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Literal log filter");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Literal log filter", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".values strong")).toHaveText("2");
  const boardUrl = page.url();
  await page.getByRole("link", { name: "調査", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "will retry 50%_ now", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "will retry 500 now", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "本文・名前 のフィルターを外す" })
    .click();
  await expect(
    page.getByRole("cell", { name: "will retry 500 now", exact: true }),
  ).toBeVisible();
  await page.goto(boardUrl);
  await page.locator("button.panel-title").first().click();
  await form
    .getByRole("button", { name: "本文・名前 のフィルターを外す" })
    .click();
  await expect(form.locator(".values strong")).toHaveText("3");
});

test("method-filtered counts use the filtered axis and follow the pointer over the tooltip", async ({
  page,
  request,
}) => {
  const end = Math.floor(Date.now() / 90000) * 90000;
  const filtered = [2, 5, 3];
  const revision = "method-axis";
  const logRecords = filtered.flatMap((count, i) =>
    Array.from({ length: 42 }, (_, j) => ({
      timeUnixNano: String(BigInt(end - (36 - i * 16) * 90000) * 1000000n),
      body: { stringValue: j < count ? "method=GET" : "worker idle" },
    })),
  );
  const batch = await request.post(
    `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
    {
      headers: { Authorization: "Bearer " + process.env.CONSOLE_TOKEN },
      data: {
        id: randomUUID().replaceAll("-", ""),
        time: new Date(end).toISOString(),
        source: {
          service: "checkout",
          workload: "app",
          slot: "blue",
          revision,
          instance: "axis",
        },
        signal: "logs",
        payload: { resourceLogs: [{ scopeLogs: [{ logRecords }] }] },
      },
    },
  );
  expect(batch.status()).toBe(204);
  const id = randomUUID();
  const scope = [{ field: "revision", values: [revision] }];
  const panel = {
    ...blankPanel,
    data: "log",
    values: [{ agg: "count", of: [] }],
    display: "chart",
    group: "source",
    conditions: scope,
    minutes: 60,
  };
  const saved = await request.post("/api/trpc/applyDashboard", {
    data: {
      expectedVersion: null,
      definition: {
        id,
        title: "Filter scale",
        panels: [
          { ...panel, title: "All" },
          {
            ...panel,
            title: "HTTP",
            conditions: [...scope, { field: "text", contains: "method=" }],
          },
        ],
      },
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto(
    "/#page=dashboards&dashboard=" + id + "&end=" + new Date(end).toISOString(),
  );
  for (const [title, values] of [
    ["All", [42, 42, 42]],
    ["HTTP", filtered],
  ] as const) {
    const card = page.locator("article").filter({
      has: page.getByRole("button", { name: title + " を編集", exact: true }),
    });
    const chart = card.getByRole("img", { name: "集計値の推移" });
    await expect(chart.locator("circle")).toHaveCount(values.length);
    const ticks = chart.locator(":scope > g > text");
    await expect(ticks.last()).toHaveText(title === "HTTP" ? "6" : "60");
    await chart.scrollIntoViewIfNeeded();
    const coords = await chart.evaluate((svg) => {
      const el = svg as SVGSVGElement,
        lines = el.querySelectorAll(":scope > g > line");
      const bottom = Number(lines[0].getAttribute("y1")),
        top = Number(lines[lines.length - 1].getAttribute("y1"));
      const max = Number(
        el.querySelectorAll(":scope > g > text")[lines.length - 1].textContent,
      );
      return [...el.querySelectorAll("circle")].map((c) => {
        const point = new DOMPoint(
          c.cx.baseVal.value,
          c.cy.baseVal.value,
        ).matrixTransform(el.getScreenCTM()!);
        return {
          x: point.x,
          y: point.y,
          value: (max * (bottom - c.cy.baseVal.value)) / (bottom - top),
        };
      });
    });
    const tip = card.getByRole("tooltip");
    for (const [i, pos] of coords.entries()) {
      expect(pos.value).toBeCloseTo(values[i]);
      if (i === 0) await page.mouse.move(pos.x, pos.y);
      else
        await tip.dispatchEvent("pointermove", {
          clientX: pos.x,
          clientY: pos.y,
        });
      await expect(tip.locator("dd")).toHaveText(values[i] + " 件");
    }
    await page.mouse.move(0, 0);
  }
});

test("values are built by dropping fields and choosing how each is aggregated", async ({
  page,
}) => {
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  const catalog = form.locator(".field-catalog");
  const row = form.locator('.worksheet-shelves [data-drop="row"]');
  const chips = row.locator(".value-chip");
  await form
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("request");
  await expect(catalog.locator("h4")).toHaveText(["測れるもの", "分けるもの"]);
  await expect(chips).toHaveText(["リクエスト数"]);

  await catalog
    .getByRole("button", { name: "所要時間", exact: true })
    .dragTo(row);
  await expect(chips).toHaveText(["リクエスト数×", "所要時間p95×"]);
  await chips
    .filter({ hasText: "所要時間" })
    .getByRole("button")
    .first()
    .click();
  const menu = form.locator(".metric-menu:popover-open");
  await expect(menu.getByRole("button")).toHaveText([
    "平均",
    "合計",
    "最小",
    "最大",
    "p50",
    "p95",
    "p99",
    "名前と単位を設定",
  ]);
  await menu.getByRole("button", { name: "平均", exact: true }).click();
  await expect(chips).toHaveText(["リクエスト数×", "所要時間平均×"]);
  // Two-stage: average per slot each minute, add the slots, then average.
  const duration = chips.filter({ hasText: "所要時間" });
  await duration.getByRole("button").first().click();
  // The menu stays open while groups are toggled.
  await menu.getByLabel("スロットごと").click();
  await expect(duration).toContainText("スロットごとの合計の平均");
  await expect(menu.getByLabel("スロットごと")).toBeChecked();
  await menu.getByLabel("スロットごと").click();
  await page.keyboard.press("Escape");
  await expect(chips).toHaveText(["リクエスト数×", "所要時間平均×"]);

  await catalog
    .getByRole("button", { name: "サービス", exact: true })
    .dragTo(row.locator(".value-chips"));
  await expect(chips).toHaveText([
    "リクエスト数×",
    "所要時間平均×",
    "サービス種類数×",
  ]);
  await catalog
    .getByRole("button", { name: "スロット", exact: true })
    .dragTo(chips.filter({ hasText: "サービス" }));
  await expect(chips.last()).toHaveText("サービス × スロット組の種類数×");
  await expect(form.locator(".preview-head h4")).toHaveText("プレビュー");

  await form.getByLabel("パネル名").fill("Built values");
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Values");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Values", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Built values を編集" }).click();
  await expect(chips).toHaveText([
    "リクエスト数×",
    "所要時間平均×",
    "サービス × スロット組の種類数×",
  ]);
  await row.getByRole("button", { name: "所要時間 · 平均 を外す" }).click();
  await expect(chips).toHaveText([
    "リクエスト数×",
    "サービス × スロット組の種類数×",
  ]);
});

async function deliver(
  request: import("@playwright/test").APIRequestContext,
  source: Record<string, string>,
  signal: string,
  payload: unknown,
  time = new Date(),
) {
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
}

test("explore narrows by observed values and leads from a row to its trace and nearby logs", async ({
  page,
  request,
}) => {
  const source = {
    service: "checkout",
    workload: "app",
    slot: "blue",
    instance: "explore-test",
    revision: "explore",
  };
  const time = new Date(Date.now() - 60000);
  const start = BigInt(+time) * 1000000n;
  const trace = Buffer.from("explore-trace-01").toString("base64");
  await deliver(request, source, "traces", {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "host.name", value: { stringValue: "explore-host" } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: "GET /explore",
                kind: 2,
                traceId: trace,
                spanId: Buffer.from("span0001").toString("base64"),
                startTimeUnixNano: String(start),
                endTimeUnixNano: String(start + 30000000n),
                attributes: [
                  { key: "http.route", value: { stringValue: "/explore" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  await deliver(request, source, "logs", {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              ["traced line", "a", trace],
              ["plain line one", "a", undefined],
              ["plain line two", "b", undefined],
            ].map(([body, kind, traceId]) => ({
              body: { stringValue: body },
              timeUnixNano: String(start),
              traceId,
              attributes: [{ key: "kind", value: { stringValue: kind } }],
            })),
          },
        ],
      },
    ],
  });
  await page.goto(
    "/#" +
      new URLSearchParams({
        page: "explore",
        data: "log",
        conditions: JSON.stringify([
          { field: "instance", values: ["explore-test"] },
        ]),
      }),
  );
  const rows = page.locator("table.rows tbody tr");
  await expect(rows).toHaveCount(3);
  const fields = page.getByRole("complementary", { name: "フィールド" });
  await fields.getByRole("button", { name: "kind", exact: true }).click();
  const values = fields.locator(".top-values button");
  await expect(values).toHaveText(["a2", "b1"]);
  await values.filter({ hasText: "b" }).click();
  await expect(page.getByRole("button", { name: "kind · b" })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("plain line two");
  await page.getByRole("button", { name: "kind のフィルターを外す" }).click();
  await expect(rows).toHaveCount(3);
  const headers = page.locator("table.rows thead th");
  await expect(headers).toHaveCount(4);
  await page.getByRole("button", { name: "サービス の前に列を追加" }).click();
  const picker = page.getByRole("dialog", { name: "列に出す属性" });
  await picker.getByLabel("属性を検索").fill("kin");
  await picker.getByRole("button", { name: "kind", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(headers.nth(1)).toContainText("kind");
  await expect(rows.first().locator("td").nth(1)).toHaveText(/^[ab]$/);
  await fields.getByRole("button", { name: "kind を列から外す" }).click();
  await expect(headers).toHaveCount(4);
  await fields.getByRole("button", { name: "kind を列に出す" }).click();
  await expect(headers.last()).toContainText("kind");
  await rows.filter({ hasText: "traced line" }).click();
  const detail = page.getByRole("complementary", { name: "行の詳細" });
  await expect(detail).toContainText("explore-test");
  await detail.getByRole("button", { name: "トレースを開く" }).click();
  await expect(
    page.getByRole("heading", { name: "トレース", exact: true }),
  ).toBeVisible();
  await page.locator(".span-row").filter({ hasText: "GET /explore" }).click();
  await expect(
    page.getByRole("complementary", { name: "スパンの詳細" }),
  ).toContainText('"http.route": "/explore"');
  // The resource is stored apart from the row and comes back with it.
  await expect(
    page.getByRole("complementary", { name: "スパンの詳細" }),
  ).toContainText('"host.name": "explore-host"');
  await expect(
    page.getByRole("heading", { name: "同じトレースのログ (1)" }),
  ).toBeVisible();
  await expect(page.locator(".trace")).toContainText("plain line one");
});

test("a span's exception shows in its trace, and rows open what they were decoded from", async ({
  page,
  request,
}) => {
  const source = {
    service: "checkout",
    workload: "app",
    slot: "blue",
    instance: "raw-test",
    revision: "raw",
  };
  const start = BigInt(Date.now() - 60000) * 1000000n;
  const trace = Buffer.from("raw-trace-000001");
  await deliver(request, source, "traces", {
    resourceSpans: [
      {
        scopeSpans: [
          {
            scope: { name: "raw-instrumentation", version: "9.9.9" },
            spans: [
              {
                name: "GET /raw",
                kind: 2,
                traceId: trace.toString("base64"),
                spanId: Buffer.from("rawspan1").toString("base64"),
                startTimeUnixNano: String(start),
                endTimeUnixNano: String(start + 20000000n),
                flags: 257,
                attributes: [
                  { key: "http.route", value: { stringValue: "/raw" } },
                ],
                events: [
                  {
                    name: "exception",
                    timeUnixNano: String(start + 10000000n),
                    attributes: [
                      {
                        key: "exception.message",
                        value: { stringValue: "raw boom" },
                      },
                      {
                        key: "exception.stacktrace",
                        value: {
                          stringValue: "Error: raw boom\n    at handler",
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  await page.goto(
    "/#" +
      new URLSearchParams({ page: "explore", trace: trace.toString("hex") }),
  );
  await expect(
    page.getByRole("heading", { name: "同じトレースのログ (1)" }),
  ).toBeVisible();
  const thrown = page.locator(".trace-log.failed");
  await expect(thrown).toContainText("raw boom");
  await thrown.getByText("スタックトレース").click();
  await expect(thrown).toContainText("at handler");
  await page.locator(".span-row").filter({ hasText: "GET /raw" }).click();
  const detail = page.getByRole("complementary", { name: "スパンの詳細" });
  // What OTLP says outside the attributes comes as attributes by convention.
  await expect(detail).toContainText(
    '"otel.scope.name": "raw-instrumentation"',
  );
  await expect(detail).toContainText('"span.kind": "server"');
  await detail.getByRole("button", { name: "元データを見る" }).click();
  await expect(detail.locator(".raw-json")).toContainText('"flags": 257');
  await expect(detail.locator(".raw-json")).toContainText('"version": "9.9.9"');
});

test("a row whose payload was dropped says so instead of showing it", async ({
  page,
}) => {
  // bin/test-console.sh stores this batch as received long ago.
  await page.goto(
    "/#" +
      new URLSearchParams({
        page: "explore",
        data: "log",
        conditions: JSON.stringify([
          { field: "instance", values: ["expired-test"] },
        ]),
      }),
  );
  await page
    .locator("table.rows tbody tr")
    .filter({ hasText: "expired payload line" })
    .click();
  const detail = page.getByRole("complementary", { name: "行の詳細" });
  await detail.getByRole("button", { name: "元データを見る" }).click();
  await expect(detail).toContainText(
    "元データは保存期間を過ぎたため削除されました",
  );
});

test("home cards lead to a service page with revisions compared and routes to explore", async ({
  page,
  request,
}) => {
  const time = new Date(Date.now() - 60000);
  const start = BigInt(+time) * 1000000n;
  for (const [revision, ms, status] of [
    ["svc-r1", 10n, 200],
    ["svc-r2", 30n, 503],
  ] as const)
    await deliver(
      request,
      {
        service: "checkout",
        workload: "app",
        slot: "blue",
        instance: "service-test",
        revision,
      },
      "traces",
      {
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    name: "GET /svc",
                    kind: 2,
                    traceId: Buffer.from(`service-${revision}--`).toString(
                      "base64",
                    ),
                    spanId: Buffer.from("svcspan1").toString("base64"),
                    startTimeUnixNano: String(start),
                    endTimeUnixNano: String(start + ms * 1000000n),
                    attributes: [
                      { key: "http.route", value: { stringValue: "/svc" } },
                      {
                        key: "http.response.status_code",
                        value: { intValue: String(status) },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  await page.goto("/");
  await page.locator(".service-row").filter({ hasText: "checkout" }).click();
  await expect(page).toHaveURL(/page=service&service=checkout/);
  await expect(
    page.getByRole("heading", { name: "checkout", exact: true }).first(),
  ).toBeVisible();
  const comparison = page
    .locator("article")
    .filter({ hasText: "リビジョンごとの比較" });
  await expect(
    comparison.getByRole("rowheader", { name: "svc-r1", exact: true }),
  ).toBeVisible();
  await expect(
    comparison.getByRole("rowheader", { name: "svc-r2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "/svc", exact: true }).click();
  await expect(page).toHaveURL(/page=explore/);
  await expect(
    page.getByRole("button", { name: "本文・名前 · /svc" }),
  ).toBeVisible();
  await expect(
    page.locator("table.rows tbody tr").filter({ hasText: "/svc" }).first(),
  ).toBeVisible();
});

test("the field dictionary names a field wherever it shows, over what its sender said", async ({
  page,
  request,
}) => {
  await deliver(
    request,
    {
      service: "checkout",
      workload: "app",
      slot: "blue",
      instance: "dictionary-test",
    },
    "metrics",
    {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "queue.waiting",
                  description: "待っている仕事の数",
                  unit: "件",
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: String(BigInt(Date.now()) * 1000000n),
                        asDouble: 3,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  );
  await page.goto("/#page=settings");
  const row = page.getByRole("row").filter({ hasText: "metric:queue.waiting" });
  await expect(row).toContainText("待っている仕事の数");
  await expect(row).toContainText("瞬間値");
  await row.getByRole("button", { name: "queue.waiting を編集" }).click();
  const dialog = page.getByRole("dialog", {
    name: "queue.waiting の名前と単位",
  });
  await expect(dialog).toContainText("送信元: 待っている仕事の数");
  await dialog.getByLabel("表示名").fill("待ち行列");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(row).toContainText("待ち行列");
  await expect(row).toContainText("利用者");
  const fields = await request.get("/api/trpc/fields");
  expect(
    (await fields.json()).result.data.find(
      (f: { key: string }) => f.key === "metric:queue.waiting",
    ),
  ).toMatchObject({
    label: "待ち行列",
    description: "待っている仕事の数",
    sender: { description: "待っている仕事の数", kind: "gauge" },
    user: { label: "待ち行列" },
  });
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form
    .getByRole("combobox", { name: "データ", exact: true })
    .selectOption("metric");
  const catalog = form.locator(".field-catalog");
  await catalog
    .getByRole("button", { name: "待ち行列", exact: true })
    .dragTo(form.locator('.worksheet-shelves [data-drop="row"]'));
  await expect(
    form
      .locator('[data-drop="row"] .value-chip')
      .filter({ hasText: "待ち行列" }),
  ).toHaveCount(1);
  // The panel's heading and summary use the person's name for the field.
  await expect(
    form.locator(".builder-main .card .cardhead").first(),
  ).toContainText("待ち行列");
  await form.getByRole("button", { name: "キャンセル", exact: true }).click();
  await page.goto("/#page=settings");
  await row.getByRole("button", { name: "待ち行列 を編集" }).click();
  await page
    .getByRole("dialog", { name: "待ち行列 の名前と単位" })
    .getByLabel("表示名")
    .fill("");
  await page
    .getByRole("dialog", { name: "待ち行列 の名前と単位" })
    .getByRole("button", { name: "保存" })
    .click();
  // Without a person's name the key shows again, as the sender gave none.
  await expect(
    row.getByRole("button", { name: "queue.waiting を編集" }),
  ).toBeVisible();
});

test("a retention rule deletes the rows it picks out once its period passes, and keeps the rest", async ({
  page,
  request,
}) => {
  const source = {
    service: "checkout",
    workload: "app",
    slot: "blue",
    instance: "retention-test",
    revision: "retention",
  };
  const old = new Date(Date.now() - 7 * 86400000 - 90 * 60000);
  const recent = new Date(Date.now() - 3600000);
  const metrics = (at: Date, names: string[]) => ({
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: names.map((name) => ({
              name,
              gauge: {
                dataPoints: [
                  { timeUnixNano: String(BigInt(+at) * 1000000n), asDouble: 1 },
                ],
              },
            })),
          },
        ],
      },
    ],
  });
  // Over a week ago: the container samples go; another metric and a log stay.
  await deliver(
    request,
    source,
    "metrics",
    metrics(old, ["cpu.usage", "memory.current"]),
  );
  await deliver(request, source, "metrics", metrics(old, ["other.metric"]));
  await deliver(request, source, "logs", {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                body: { stringValue: "old retention line" },
                timeUnixNano: String(BigInt(+old) * 1000000n),
              },
            ],
          },
        ],
      },
    ],
  });
  // Within the week: kept.
  await deliver(request, source, "metrics", metrics(recent, ["cpu.usage"]));

  await page.goto("/#page=retention");
  const rules = page.getByRole("region", { name: "保持期間" });
  await expect(rules).toContainText("どのルールにも当てはまらない行");
  await expect(rules.locator(".retention-default")).toContainText(
    /約 [\d,]+ 行/,
  );
  // Configuration reads no period, so the header offers no time or refresh.
  const header = page.locator("main > header");
  await expect(header.getByLabel("自動更新")).toHaveCount(0);
  await expect(header.getByRole("group", { name: "よく使う期間" })).toHaveCount(
    0,
  );
  await page.goto("/#page=settings");
  await expect(
    header.getByRole("button", { name: "更新", exact: true }),
  ).toHaveCount(0);
  // Monitors refresh their states but read no period from the header.
  await page.goto("/#page=monitors");
  await expect(
    header.getByRole("button", { name: "更新", exact: true }),
  ).toBeVisible();
  await expect(header.getByLabel("自動更新")).toBeVisible();
  await expect(header.getByRole("group", { name: "よく使う期間" })).toHaveCount(
    0,
  );
  await page.goto("/#page=explore");
  await expect(
    header.getByRole("group", { name: "よく使う期間" }),
  ).toBeVisible();
  await page.goto("/#page=retention");
  await page.getByRole("button", { name: "ルールを追加" }).click();
  const editor = page.getByRole("region", { name: "保持ルールの編集" });
  await editor
    .getByLabel("名前", { exact: true })
    .fill("コンテナの CPU とメモリ");
  await editor.getByLabel("データの種類").selectOption("metric");
  await editor
    .getByLabel("名前が一致（カンマ区切り、空なら問わない）")
    .fill("cpu.usage, memory.current");
  await editor.getByRole("button", { name: "1週間" }).click();
  await expect(editor.getByLabel("保持期間の長さ")).toHaveValue("7");
  await expect(editor.locator(".retention-preview")).toHaveText(
    /1日あたり約 [\d,]+ 行/,
  );
  await editor.getByRole("button", { name: "保存" }).click();
  const row = rules
    .locator("tbody tr")
    .filter({ hasText: "コンテナの CPU とメモリ" });
  await expect(row).toContainText(
    "メトリクス · 名前: cpu.usage, memory.current",
  );
  await expect(row).toContainText("1週間");

  const names = async (data: string) => {
    const res = await request.get("/api/trpc/events", {
      params: {
        input: JSON.stringify({
          data,
          minutes: 43200,
          conditions: [{ field: "instance", values: ["retention-test"] }],
          end: new Date().toISOString(),
        }),
      },
    });
    const items: { name: string; body: string }[] = (await res.json()).result
      .data.items;
    return items.map((i) => i.name || i.body).sort();
  };
  // The worker sweeps within a few ticks.
  await expect
    .poll(() => names("metric"), { timeout: 60000 })
    .toEqual(["cpu.usage", "other.metric"]);
  expect(await names("log")).toEqual(["old retention line"]);

  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "削除" }).click();
  await expect(row).toHaveCount(0);
});
