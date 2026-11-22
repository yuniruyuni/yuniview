import { expect, test } from "@playwright/test";

test("daily visits deduplicate across blue/green and distinguish zero and unmeasured days", async ({
  request,
  page,
}) => {
  const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const previous = new Date(Date.parse(day) - 86400000)
    .toISOString()
    .slice(0, 10);
  async function visit(slot: string, day: string, digest: string) {
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
          signal: "usage",
          payload: { kind: "account", day, digest },
        },
      },
    );
    expect(r.status()).toBe(204);
  }
  await visit("blue", previous, "");
  await visit("blue", day, "a".repeat(64));
  await visit("green", day, "a".repeat(64));
  await visit("green", day, "b".repeat(64));
  await page.goto("/#page=usage");
  await expect(
    page
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: day, exact: true }) })
      .getByRole("cell"),
  ).toHaveText("2");
  await expect(
    page
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: previous, exact: true }),
      })
      .getByRole("cell"),
  ).toHaveText("0");
  await expect(page.getByRole("cell", { name: "—", exact: true })).toHaveCount(
    28,
  );
});
