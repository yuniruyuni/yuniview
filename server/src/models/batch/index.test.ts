import { expect, test } from "bun:test";
import { Batch } from ".";
import type { Envelope } from "./schema";

const source = { service: "app", workload: "app", instance: "i-1" };
const time = "2026-11-28T00:00:00.000Z";
const resource = {
  attributes: [
    { key: "host.name", value: { stringValue: "blue" } },
    { key: "service.name", value: { stringValue: "app" } },
  ],
};
const span = (name: string) => ({
  name,
  traceId: "0".repeat(32),
  spanId: "1".repeat(16),
  attributes: [{ key: "http.route", value: { stringValue: name } }],
});
const indexed = (signal: Envelope["signal"], payload: Envelope["payload"]) =>
  Batch.index(
    Batch.received(
      { id: "a".repeat(32), source, time, signal, payload },
      new Date(time),
    ),
  );

test("rows refer to their resource instead of carrying it", () => {
  const b = indexed("traces", {
    resourceSpans: [
      { resource, scopeSpans: [{ spans: [span("/a"), span("/b")] }] },
    ],
  });
  expect(b.resources).toHaveLength(1);
  expect(b.resources[0]?.attrs).toEqual({
    "host.name": "blue",
    "service.name": "app",
  });
  expect(b.events.map((e) => e.resource)).toEqual([
    b.resources[0]?.digest as string,
    b.resources[0]?.digest as string,
  ]);
  expect(b.events[0]?.attrs).toEqual({ "http.route": "/a" });
});

test("logs and metrics leave their resource out of attrs too", () => {
  const logs = indexed("logs", {
    resourceLogs: [
      {
        resource,
        scopeLogs: [{ logRecords: [{ body: { stringValue: "x" } }] }],
      },
    ],
  });
  const metrics = indexed("metrics", {
    resourceMetrics: [
      {
        resource,
        scopeMetrics: [
          {
            metrics: [{ name: "m", gauge: { dataPoints: [{ asDouble: 1 }] } }],
          },
        ],
      },
    ],
  });
  for (const b of [logs, metrics]) {
    expect(b.resources).toHaveLength(1);
    expect(b.events[0]?.resource).toBe(b.resources[0]?.digest as string);
    expect(b.events[0]?.attrs).not.toHaveProperty("resource");
  }
});

test("each resource of a batch is kept once, and rows without one refer to none", () => {
  const green = {
    attributes: [{ key: "host.name", value: { stringValue: "green" } }],
  };
  const b = indexed("traces", {
    resourceSpans: [
      { resource, scopeSpans: [{ spans: [span("/a")] }] },
      { resource: green, scopeSpans: [{ spans: [span("/b")] }] },
      { resource, scopeSpans: [{ spans: [span("/c")] }] },
      { scopeSpans: [{ spans: [span("/d")] }] },
    ],
  });
  expect(b.resources).toHaveLength(2);
  const [first, second, third, fourth] = b.events.map((e) => e.resource);
  expect(first).toBe(third as string);
  expect(second).not.toBe(first as string);
  expect(fourth).toBeNull();
  expect(indexed("stdout", ["line"]).events[0]?.resource).toBeNull();
  expect(indexed("stdout", ["line"]).resources).toEqual([]);
});

test("batched stdout lines and cgroup samples keep their own times", () => {
  const lines = indexed("stdout", [
    { at: "2026-11-28T00:00:01.250Z", line: "first" },
    { at: "2026-11-28T00:00:09Z", line: "second" },
    "bare",
  ]);
  expect(lines.events.map((e) => [e.at, e.body])).toEqual([
    ["2026-11-28T00:00:01.250Z", "first"],
    ["2026-11-28T00:00:09.000Z", "second"],
    [time, "bare"],
  ]);
  const samples = indexed("resources", {
    samples: [
      { at: "2026-11-28T00:00:10Z", cpuUsageUsec: 1, memoryBytes: 2 },
      { at: "2026-11-28T00:00:20Z", cpuUsageUsec: 3, memoryBytes: 4 },
    ],
  });
  expect(samples.events.map((e) => [e.at, e.name, e.value])).toEqual([
    ["2026-11-28T00:00:10.000Z", "cpu.usage", 1],
    ["2026-11-28T00:00:10.000Z", "memory.current", 2],
    ["2026-11-28T00:00:20.000Z", "cpu.usage", 3],
    ["2026-11-28T00:00:20.000Z", "memory.current", 4],
  ]);
  // Agents before batching sent one untimed sample per batch.
  const single = indexed("resources", { cpuUsageUsec: 5, memoryBytes: 6 });
  expect(single.events.map((e) => [e.at, e.value])).toEqual([
    [time, 5],
    [time, 6],
  ]);
});
