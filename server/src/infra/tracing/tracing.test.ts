import { describe, expect, test } from "bun:test";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { traced, tracedMethods, tracingEnabled, untraced } from "./index";

// 送り先が無いときに計装が有効だと、開発時やテスト時に送り先を用意させる
// ことになる。何もしないで通り抜けること。
describe("送り先が無いとき", () => {
  test("計装しないが、値はそのまま返る", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(tracingEnabled()).toBe(false);
    expect(await traced("x", () => 42)).toBe(42);
  });

  test("メソッドを包んでも元のまま動く", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const repo = { get: async (n: number) => n * 2 };
    expect(await tracedMethods(repo, "repo.x").get(3)).toBe(6);
  });
});

describe("送り先があるとき", () => {
  test("値はそのまま返る", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "unix:///dev/null";
    expect(tracingEnabled()).toBe(true);
    expect(await traced("x", () => 42)).toBe(42);
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  // 失敗を握り潰すと、遅いうえに失敗している呼び出しが「ただ遅いだけ」に
  // 見える。例外はそのまま外へ出ること。
  test("失敗はそのまま外へ出る", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "unix:///dev/null";
    const boom = () => {
      throw new Error("boom");
    };
    expect(traced("x", boom)).rejects.toThrow("boom");
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  // メソッド以外 (値や undefined) を包むと壊れる。素通しすること。
  test("メソッド以外はそのまま通す", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "unix:///dev/null";
    const repo = { name: "settings", get: async () => 1 };
    expect(tracedMethods(repo, "repo.x").name).toBe("settings");
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });
});

// 受け取ったテレメトリの処理を計測すると、その計測がまたテレメトリとして
// 自分に届く。受け取るたびに記録が増え、受け取ったデータより多くなった。
describe("計測しない区間", () => {
  test("中ではスパンを作らず、外では作る", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "unix:///dev/null";
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    const exporter = new InMemorySpanExporter();
    trace.setGlobalTracerProvider(
      new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      }),
    );
    const repo = tracedMethods({ get: async () => 1 }, "repo.x");

    expect(
      await untraced(() => traced("usecase", async () => repo.get())),
    ).toBe(1);
    expect(exporter.getFinishedSpans()).toHaveLength(0);

    await traced("usecase", async () => repo.get());
    expect(exporter.getFinishedSpans().map((s) => s.name)).toEqual([
      "repo.x.get",
      "usecase",
    ]);
    // 登録は 1 度しか効かない。外さないと、後に走るテストが自分の記録先を登録できない。
    trace.disable();
    context.disable();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });
});
