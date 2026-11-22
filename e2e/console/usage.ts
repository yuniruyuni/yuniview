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
  await visit("blue", previous, "");
  await visit("blue", day, "a".repeat(64));
  await visit("green", day, "a".repeat(64));
  await visit("green", day, "b".repeat(64));
  await visit("green", day, "c".repeat(64), "checkout.cart");
  await page.goto("/#page=dashboards");
  await page.getByRole("button", { name: "ダッシュボードを作成" }).click();
  const form = page.locator("form.editor");
  await form
    .getByRole("combobox", { name: "指標", exact: true })
    .selectOption("distinct");
  await form.getByLabel("集合名").fill("visit.account");
  for (const [date, count] of [
    [day, "2"],
    [previous, "0"],
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
  await form.getByRole("button", { name: "パネルを複製" }).click();
  await expect(form.getByLabel("パネル名")).toHaveValue(/のコピー/);
  await form.getByRole("button", { name: "キャンセル" }).click();
  await page.goto(
    "/#page=metrics&source=checkout&slot=blue&metric=memory.current",
  );
  await page
    .getByRole("button", { name: "この表示をダッシュボードに追加" })
    .click();
  await page.getByRole("button", { name: "編集して追加" }).click();
  await expect(
    form.getByRole("combobox", { name: "スロット", exact: true }),
  ).toHaveValue("blue");
  await form
    .getByRole("combobox", { name: "表示", exact: true })
    .selectOption("pivot");
  await form.getByLabel("名前", { exact: true }).fill("Resource pivot");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Resource pivot" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "memory.current を編集" }).click();
  await expect(
    form.getByRole("combobox", { name: "表示", exact: true }),
  ).toHaveValue("pivot");
});
