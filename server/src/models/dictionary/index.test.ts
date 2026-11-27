import { expect, test } from "bun:test";
import { FieldNote } from ".";

test("people's words win over the sender's, and core fields are always there", () => {
  const dict = FieldNote.dictionary([
    {
      key: "metric:cpu.usage",
      sender: { label: "CPU 時間", unit: "µs", kind: "counter" },
      person: { label: "CPU" },
    },
  ]);
  const cpu = dict.find((f) => f.key === "metric:cpu.usage");
  expect(cpu).toMatchObject({ label: "CPU", unit: "µs", kind: "counter" });
  expect(dict.find((f) => f.key === "source")?.label).toBe("サービス");
  expect(dict.find((f) => f.key === "metric:queue.depth")).toBeUndefined();
});

test("a bare key reads as itself when nobody named it", () => {
  const [q] = FieldNote.dictionary([
    { key: "attr:http.route", sender: {}, person: {} },
  ]).filter((f) => f.key === "attr:http.route");
  expect(q.label).toBe("http.route");
});

test("clearing a part of a person's note shows the sender's again", () => {
  const change = FieldNote.edited(
    {
      key: "set:x",
      sender: { label: "S" },
      person: { label: "P", unit: "件" },
    },
    "set:x",
    { label: null },
  );
  expect(change).toEqual({ key: "set:x", person: { unit: "件" } });
});
