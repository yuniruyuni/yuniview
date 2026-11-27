import { expect, test } from "bun:test";
import { Resource } from ".";

test("equal attributes in any order share a digest", () => {
  const a = Resource.of({
    "service.name": "app",
    process: { pid: "1", args: ["bun", "server"] },
  });
  const b = Resource.of({
    process: { args: ["bun", "server"], pid: "1" },
    "service.name": "app",
  });
  expect(a?.digest).toMatch(/^[0-9a-f]{32}$/);
  expect(b?.digest).toBe(a?.digest as string);
});

test("different attributes have different digests", () => {
  const a = Resource.of({ "host.name": "blue" });
  const b = Resource.of({ "host.name": "green" });
  const c = Resource.of({ "host.name": ["blue"] });
  expect(new Set([a?.digest, b?.digest, c?.digest]).size).toBe(3);
});

test("no attributes is no resource", () => {
  expect(Resource.of({})).toBeNull();
});
