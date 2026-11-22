import { expect, test } from "@playwright/test";

test("daily visits deduplicate across blue/green and distinguish zero and unmeasured days", async ({
  request,
  page,
}) => {
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const previous = new Date(Date.parse(day) - 86400000)
    .toISOString()
    .slice(0, 10);
  async function visit(
    slot: string,
    day: string,
    digest: string,
    field?: string,
  ) {
    const token =
      slot === "blue"
        ? process.env.CONSOLE_TOKEN
        : process.env.GREEN_TEST_TOKEN;
    const r = await request.post(
      `http://127.0.0.1:${process.env.INGEST_PORT}/api/agent/v1/batches`,
      {
        headers: { Authorization: "Bearer " + token },
        data: {
          id: crypto.randomUUID().replaceAll("-", ""),
          source: {
            service: "checkout",
            workload: "app",
            slot,
            instance: slot,
          },
          time: new Date().toISOString(),
          signal: field ? "daily_set" : "usage",
          payload: field
            ? { field, day, digest }
            : { kind: "account", day, digest },
        },
      },
    );
    expect(r.status()).toBe(204);
  }
  const first = new Date(Date.parse(previous) - 86400000)
    .toISOString()
    .slice(0, 10);
  await visit("blue", first, "a".repeat(64));
  await visit("blue", previous, "");
  await visit("blue", day, "a".repeat(64));
  await visit("green", day, "a".repeat(64));
  await visit("green", day, "b".repeat(64));
  await visit("green", day, "c".repeat(64), "checkout.cart");
  await page.goto("/#page=dashboards&minutes=10080");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form
    .locator(".field-catalog")
    .getByRole("button", { name: "ユニーク数", exact: true })
    .click();
  const format = form.getByRole("combobox", { name: "表示形式", exact: true });
  await expect(format.locator("option")).toHaveCount(8);
  await form.getByLabel("集合名").fill("visit.account");
  for (const [mark, name] of [
    ["auto", "系列別の折れ線グラフ"],
    ["bar", "カテゴリ別の棒グラフ"],
    ["area", "全系列のエリアグラフ"],
    ["stacked_area", "全系列の積み上げ面グラフ"],
    ["line", "系列別の折れ線グラフ"],
  ]) {
    await format.selectOption(mark);
    await expect(form.getByRole("img", { name, exact: true })).toBeVisible();
  }
  await format.selectOption("summary");
  await expect(
    form
      .getByRole("row")
      .filter({ hasText: "checkout" })
      .getByRole("cell")
      .nth(1),
  ).toHaveText("3");
  await format.selectOption("value");
  await expect(form.locator(".values strong")).toHaveText("3");
  await format.selectOption("table");
  await form
    .locator('[data-drop="row"] .shelf-chip')
    .getByRole("button", { name: "時刻", exact: true })
    .click();
  const dailyGrain = form.getByLabel("行の時刻の粒度");
  await expect(dailyGrain.locator("option")).toHaveText(["1日"]);
  await expect(dailyGrain).toBeDisabled();
  await expect(form.getByLabel("行のタイムゾーン")).toHaveValue("JST");
  await page.keyboard.press("Escape");
  await expect(
    form
      .locator(".field-catalog")
      .getByRole("button", { name: "時刻", exact: true }),
  ).toHaveCount(1);
  await form.getByLabel("集合名").fill("visit.account");
  for (const [date, count] of [
    [day, "2"],
    [previous, "0"],
    [first, "1"],
  ]) {
    await expect(
      form
        .getByRole("row")
        .filter({ has: page.getByRole("rowheader", { name: date }) })
        .getByRole("cell"),
    ).toHaveText(count);
  }
  await form.getByLabel("集合名").fill("checkout.cart");
  await expect(
    form
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: day }) })
      .getByRole("cell"),
  ).toHaveText("1");
  await expect(form.getByRole("rowheader", { name: previous })).toHaveCount(0);
  const actions = form.getByRole("button", { name: "パネル操作" });
  const copy = form.getByRole("button", { name: "パネルを複製" });
  const remove = form.getByRole("button", { name: "パネルを削除" });
  await expect(copy).toBeHidden();
  await actions.click();
  await expect(remove).toBeDisabled();
  await actions.press("Escape");
  await expect(copy).toBeHidden();
  await actions.click();
  await copy.click();
  await expect(form.getByLabel("パネル名")).toHaveValue(/のコピー/);
  await expect(remove).toBeHidden();
  await actions.click();
  await remove.click();
  await expect(form.locator(".canvas-grid article")).toHaveCount(1);
  await expect(form.locator(".canvas-grid")).not.toContainText("のコピー");
  await form.getByRole("button", { name: "キャンセル" }).click();
  await page.goto(
    "/#page=metrics&source=checkout&slot=blue&metric=memory.current",
  );
  await page
    .getByRole("button", { name: "この表示をダッシュボードに追加" })
    .click();
  await page.getByRole("button", { name: "編集して追加" }).click();
  await expect(
    form.getByRole("button", { name: "スロット · blue", exact: true }),
  ).toBeVisible();
  await form
    .getByRole("combobox", { name: "表示形式", exact: true })
    .selectOption("table");
  await form.getByRole("button", { name: "セーブ" }).click();
  await form.getByLabel("名前", { exact: true }).fill("Resource pivot");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Resource pivot" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "memory.current を編集" }).click();
  await expect(
    form.getByRole("combobox", { name: "表示形式", exact: true }),
  ).toHaveValue("table");
});
