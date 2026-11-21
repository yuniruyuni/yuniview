/**
 * 要求ごとに 1 行残す。
 *
 * これが無いと、何が起きたのかを後から辿れない。経路 (HAProxy) のログにも
 * 要求は残るが、あちらから見えるのは外形だけで、アプリの中の事情は分からない。
 *
 * trace_id を載せるのが要。遅い要求をトレースで見つけたとき、同じ id で
 * ログを引けば、その要求の周りで何が起きていたかまで辿れる。
 *
 * 形は logfmt にする。人が読めて、そのまま検索の条件にも使える。JSON は
 * 検索には向くが、journalctl で追うときに読みにくい。
 *
 * 経路は当たった型 (/api/sse/widget/:token) を残し、実際の値は残さない。
 * パスの一部がそのまま資格情報になっている経路があり、実際の値を書くと
 * ログを読める相手に購読の権利を配ってしまう。
 *
 * ここで要求全体のスパンも張る。これが無いと、内側 (tRPC) で作られたスパンは
 * ログを書く時点で既に終わっており、trace_id を載せられない。張っておけば
 * トレースの根が要求そのものになり、構造としても素直になる。
 */
import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Context, MiddlewareHandler } from "hono";
import type { ILogger } from "../../infra/logger/types";

/**
 * 記録しない経路。
 *
 * 健康確認は 3 秒ごとに 2 系へ来る。1 日 5 万行を超え、本物の記録がこの中に
 * 埋もれる。落ちていれば経路側の指標に出るので、ここで残す必要が無い。
 */
const SKIP = new Set(["/health"]);

/**
 * 型ではなく実際のパスを残してよい接頭辞。
 *
 * 型だけにすると tRPC が /api/trpc/* に潰れ、どの手続きが遅いのかが
 * 分からなくなる。この下に入るのは手続きの名前だけで、資格情報は載らない。
 * 広げるときは「その経路のパスに秘密が入りうるか」を必ず確かめる。
 */
const SAFE_DETAIL = ["/api/trpc/"];

/**
 * 記録する経路。既定は当たった型で、安全と分かっている所だけ実際の値。
 *
 * next() の後で呼ぶこと。前では経路がまだ決まっておらず、この middleware
 * 自身の登録パス (/*) が返る。
 */
function routeOf(c: Context): string {
  if (SAFE_DETAIL.some((p) => c.req.path.startsWith(p))) return c.req.path;
  return c.req.routePath;
}

/** logfmt の値。空白や引用符が入ると壊れるので、必要なときだけ括る。 */
function value(v: string | number): string {
  const s = String(v);
  return /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

export function requestLog(logger: ILogger): MiddlewareHandler {
  const log = logger.child("http");
  const tracer = trace.getTracer("http");

  return async (c: Context, next) => {
    if (SKIP.has(c.req.path)) return next();

    const started = performance.now();
    // 問い合わせ文字列は落とす。ウィジェットのトークンなど、そのまま残すと
    // 購読に必要な資格情報を配ってしまうものが載る。
    // 名前は経路が決まってから updateName で入れる。仮の名前に実際のパスを
    // 使うと、伏せたい値がスパンに残る。
    return tracer.startActiveSpan(c.req.method, async (span) => {
      try {
        await next();
      } finally {
        const route = routeOf(c);
        span.updateName(`${c.req.method} ${route}`);
        const status = c.res.status;
        const ms = Math.round(performance.now() - started);
        span.setAttributes({
          "http.request.method": c.req.method,
          "http.route": route,
          "http.response.status_code": status,
        });
        if (status >= 500) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();

        const fields: [string, string | number][] = [
          ["method", c.req.method],
          ["path", route],
          ["status", status],
          ["ms", ms],
          // 終えた後でも文脈から引ける。これが無いとログとトレースが繋がらない。
          ["trace_id", span.spanContext().traceId],
        ];
        const line = fields.map(([k, v]) => `${k}=${value(v)}`).join(" ");
        // 5xx だけ error にする。4xx は呼ぶ側の誤りで、こちらの異常ではない。
        if (status >= 500) log.error(line);
        else log.info(line);
      }
    });
  };
}
