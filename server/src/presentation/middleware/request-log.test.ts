import { describe, expect, test } from "bun:test";
import { context, SpanKind, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Hono } from "hono";
import type { ILogger } from "../../infra/logger/types";
import { requestLog } from "./request-log";

function collector(): { lines: string[]; logger: ILogger } {
  const lines: string[] = [];
  const logger = {
    child: () => logger,
    debug: () => {},
    info: (m: string) => lines.push(`info ${m}`),
    warn: () => {},
    error: (m: string) => lines.push(`error ${m}`),
  } as unknown as ILogger;
  return { lines, logger };
}

describe("要求の記録", () => {
  test("方法・経路・状態・所要が残る", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/x", (c) => c.text("ok"));
    await app.request("/x");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("method=GET");
    expect(lines[0]).toContain("path=/x");
    expect(lines[0]).toContain("status=200");
    expect(lines[0]).toMatch(/ms=\d+/);
  });

  // 健康確認は 3 秒ごとに 2 系へ来る。1 日 5 万行を超え、本物の記録が埋もれる。
  test("健康確認は残さない", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/health", (c) => c.json({ status: "ok" }));
    await app.request("/health");
    expect(lines).toHaveLength(0);
  });

  // 4xx は呼ぶ側の誤り。こちらの異常ではないので error にしない。
  test("5xx だけを error にする", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/a", (c) => c.text("nope", 404));
    app.get("/b", (c) => c.text("boom", 500));
    await app.request("/a");
    await app.request("/b");
    expect(lines[0].startsWith("info")).toBe(true);
    expect(lines[1].startsWith("error")).toBe(true);
  });

  // 問い合わせ文字列にはウィジェットのトークンが載る。そのまま残すと
  // 購読に必要な資格情報を配ってしまう。
  test("問い合わせ文字列は残さない", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/w", (c) => c.text("ok"));
    await app.request("/w?token=secret-value");
    expect(lines[0]).not.toContain("secret-value");
  });

  // 外側にスパンが無くても id が載ること。内側 (tRPC) のスパンは、ログを
  // 書く時点で既に終わっている。ここで張らないと繋がらない (実際に踏んだ)。
  test("外側にスパンが無くても id が載る", async () => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);

    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/t", (c) => c.text("ok"));
    await app.request("/t");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe(SpanKind.SERVER);
    expect(spans[0].attributes["http.route"]).toBe("/t");
    expect(lines[0]).toMatch(/trace_id=[0-9a-f]{32}/);
  });

  // trace_id が無いと、遅いトレースを見つけてもその周りのログを引けない。
  test("トレースがあれば id が載る", async () => {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
    });
    trace.setGlobalTracerProvider(provider);

    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/t", (c) => c.text("ok"));

    await trace.getTracer("t").startActiveSpan("outer", async (span) => {
      await app.request("/t");
      span.end();
    });

    expect(lines[0]).toMatch(/trace_id=[0-9a-f]{32}/);
  });
  // パスの一部がそのまま資格情報になっている経路がある (ウィジェットの購読)。
  // 実際の値を書くと、ログを読める相手に購読の権利を配ってしまう。
  test("経路に埋め込まれた値は残さない", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.get("/api/sse/widget/:token", (c) => c.text("ok"));
    await app.request("/api/sse/widget/SECRET-TOKEN");
    expect(lines[0]).not.toContain("SECRET-TOKEN");
    expect(lines[0]).toContain("path=/api/sse/widget/:token");
  });

  // 型だけにすると tRPC が /api/trpc/* に潰れ、どの手続きが遅いのかが
  // 分からなくなる。ここは手続きの名前しか入らないので残す。
  test("tRPC は手続きの名前まで残す", async () => {
    const { lines, logger } = collector();
    const app = new Hono();
    app.use(requestLog(logger));
    app.all("/api/trpc/*", (c) => c.text("ok"));
    await app.request("/api/trpc/post.listPublic");
    expect(lines[0]).toContain("path=/api/trpc/post.listPublic");
  });
});
