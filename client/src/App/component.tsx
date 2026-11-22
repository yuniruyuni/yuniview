import { useEffect, useState } from "react";
import {
  blankPanel,
  defaults,
  type Filter,
  type Overview,
  type Panel,
  type Point,
} from "../../../shared/console";
import { clock, number, useQuery } from "../api";
import { DashboardTime } from "./DashboardTime";
import { Explorer, Trace } from "./Explore";
import { Library } from "./Library";
import { PanelView, Select } from "./Panels";

const pages = {
  overview: "サービス一覧",
  logs: "ログ",
  apm: "APM",
  metrics: "メトリクス",
  dashboards: "ダッシュボード",
  monitors: "モニター",
};
type Page = keyof typeof pages;
const empty: Overview = {
  services: [],
  slots: [],
  metrics: [],
  dailyFields: [],
  revisions: [],
};
function read() {
  return new URLSearchParams(window.location.hash.slice(1));
}
function link(params: Record<string, string>) {
  const p = read();
  if (params.page && params.page !== p.get("page")) {
    p.delete("sheet");
    p.delete("logContains");
  }
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return `#${p.toString()}`;
}
function options(list: string[]): [string, string][] {
  return [["", "すべて"], ...list.map((v): [string, string] => [v, v])];
}
function navigate(params: Record<string, string>) {
  window.location.hash = link(params);
}
export function App() {
  const [incoming, setIncoming] = useState<Panel | null>(null);
  const [url, setUrl] = useState(read);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const change = () => setUrl(read());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(timer);
  }, [auto]);
  const key =
    url.get("page") === "usage" ? "dashboards" : (url.get("page") ?? "");
  const page: Page = Object.hasOwn(pages, key) ? (key as Page) : "overview";
  const logContains =
    page === "logs" ? url.get("logContains") || undefined : undefined;
  const f: Filter = {
    ...defaults,
    source: url.get("source") ?? "",
    workload: url.get("workload") ?? "",
    instance: url.get("instance") ?? "",
    slot: url.get("slot") ?? "",
    revision: url.get("revision") ?? "",
    text: url.get("text") ?? "",
    minutes: Math.min(
      43200,
      Math.max(1, Math.round(Number(url.get("minutes") || 60) || 60)),
    ),
  };
  const fixed = url.get("end");
  const end =
    fixed && Number.isFinite(Date.parse(fixed))
      ? new Date(fixed).toISOString()
      : now;
  const query = useQuery<Overview>("overview", { ...f, end });
  const meta = query.data ?? empty;
  const trace = url.get("trace") ?? "";
  const showTrace = (id: string) => navigate({ page: "apm", trace: id });
  const panel = (measure: Panel["measure"], title: string): Panel => ({
    ...blankPanel,
    ...f,
    measure,
    title,
  });
  const investigate = (p: Point) => {
    const width = Math.max(1, Math.ceil((f.minutes * 60) / 40));
    return link({
      page: "logs",
      source: p.series || f.source,
      minutes: String(Math.ceil(width / 60)),
      end: new Date(Date.parse(p.bucket) + width * 1000).toISOString(),
    });
  };
  const refresh = () => {
    setNow(new Date().toISOString());
    navigate({ end: "" });
  };
  return (
    <div className="workspace">
      <aside>
        <h1>yuniview</h1>
        <nav aria-label="メインナビゲーション">
          {Object.entries(pages).map(([k, title]) => (
            <button
              type="button"
              key={k}
              aria-current={page === k ? "page" : undefined}
              onClick={() => navigate({ page: k, trace: "" })}
            >
              {title}
            </button>
          ))}
          <a className="privacy-link" href="/privacy/">
            プライバシーポリシー
          </a>
        </nav>
      </aside>
      <main>
        <header>
          <div>
            <h2>{trace && page === "apm" ? "トレース詳細" : pages[page]}</h2>
          </div>
          <div className="tools">
            <label className="inline">
              <input
                type="checkbox"
                checked={auto && !fixed}
                onChange={(e) => {
                  setAuto(e.target.checked);
                  if (fixed) refresh();
                }}
              />
              自動更新
            </label>
            <button type="button" onClick={refresh}>
              更新
            </button>
          </div>
        </header>
        {page !== "dashboards" &&
          page !== "monitors" &&
          !(trace && page === "apm") && (
            <form
              className="filterbar"
              key={JSON.stringify(f)}
              onSubmit={(e) => {
                e.preventDefault();
                const fields = new FormData(e.currentTarget);
                const dt = String(fields.get("end") ?? "");
                navigate(
                  Object.fromEntries(
                    ["text", "revision", "workload", "instance"]
                      .map((k) => [k, String(fields.get(k) ?? "")])
                      .concat([["end", dt ? new Date(dt).toISOString() : ""]]),
                  ),
                );
              }}
            >
              <Select
                label="サービス"
                choices={options([
                  ...new Set([
                    ...meta.services.map((s) => s.source),
                    ...(f.source ? [f.source] : []),
                  ]),
                ])}
                value={f.source}
                change={(v) => navigate({ source: v, trace: "" })}
              />
              <Select
                label="系"
                choices={options([
                  ...new Set([...meta.slots, ...(f.slot ? [f.slot] : [])]),
                ])}
                value={f.slot}
                change={(v) => navigate({ slot: v })}
              />
              <label>
                リビジョン
                <input
                  placeholder="すべて"
                  defaultValue={f.revision}
                  name="revision"
                />
              </label>
              <Select
                label="期間"
                choices={[...new Set([5, 15, 60, 360, 1440, 10080, f.minutes])]
                  .sort((a, b) => a - b)
                  .map((m) => [
                    String(m),
                    m >= 1440
                      ? `${m / 1440}日`
                      : m >= 60
                        ? `${m / 60}時間`
                        : `${m}分`,
                  ])}
                value={String(f.minutes)}
                change={(v) => navigate({ minutes: v })}
              />
              <label>
                本文・名前
                <input
                  name="text"
                  defaultValue={f.text}
                  placeholder="キーワード検索"
                />
              </label>
              <details className="advanced">
                <summary>詳細条件</summary>
                <div className="tools">
                  <label>
                    ワークロード
                    <input name="workload" defaultValue={f.workload} />
                  </label>
                  <label>
                    インスタンス
                    <input name="instance" defaultValue={f.instance} />
                  </label>
                  <label>
                    終了時刻
                    <input
                      type="datetime-local"
                      name="end"
                      key={end && (fixed ?? "")}
                      defaultValue={
                        fixed
                          ? new Date(
                              Date.parse(end) -
                                new Date(end).getTimezoneOffset() * 60000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                    />
                  </label>
                </div>
              </details>
              <button type="submit">検索</button>
            </form>
          )}
        {fixed && page !== "dashboards" && (
          <p>
            終了時刻 {clock(end)}{" "}
            <button type="button" onClick={refresh}>
              現在に戻る
            </button>
          </p>
        )}
        {query.error && (
          <p role="alert">サービス情報の取得に失敗しました。{query.error}</p>
        )}
        {page === "overview" ? (
          <>
            <div className="summary">
              {[
                ["登録サービス", meta.services.length],
                [
                  "受信 server span",
                  meta.services.reduce((n, s) => n + s.requests, 0),
                ],
                [
                  "失敗した要求",
                  meta.services.reduce((n, s) => n + s.errors, 0),
                ],
              ].map(([title, n]) => (
                <div key={title}>
                  <small>{title}</small>
                  <strong>{query.data ? number(Number(n)) : "—"}</strong>
                </div>
              ))}
            </div>
            <div className="cards">
              <PanelView
                panel={panel("requests", "リクエスト数")}
                end={end}
                choose={investigate}
              />
              <PanelView
                panel={panel("latency", "p95 応答時間")}
                end={end}
                choose={investigate}
              />
            </div>
            <h3>登録サービス</h3>
            <div className="card scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      "サービス",
                      "最終受信",
                      "要求数",
                      "失敗数",
                      "p95",
                      "調査",
                    ].map((s) => (
                      <th key={s}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {meta.services
                    .filter((s) => !f.source || s.source === f.source)
                    .map((s) => (
                      <tr key={s.source}>
                        <th>{s.source}</th>
                        <td>{s.last ? clock(s.last) : "未受信"}</td>
                        <td>{s.requests}</td>
                        <td>{s.errors}</td>
                        <td>{number(s.latency)} ms</td>
                        <td>
                          <button
                            type="button"
                            onClick={() =>
                              navigate({ page: "logs", source: s.source })
                            }
                          >
                            ログ
                          </button>{" "}
                          <button
                            type="button"
                            onClick={() =>
                              navigate({ page: "apm", source: s.source })
                            }
                          >
                            APM
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {query.data && !meta.services.length && (
                <p className="empty">登録済みのサービスはありません。</p>
              )}
            </div>
          </>
        ) : page === "monitors" || page === "dashboards" ? (
          <Library
            incoming={incoming}
            consumed={() => setIncoming(null)}
            key={page}
            timeControl={
              <DashboardTime
                minutes={f.minutes}
                end={end}
                fixed={!!fixed}
                change={(minutes, stamp) => {
                  setNow(new Date().toISOString());
                  navigate({ minutes: String(minutes), end: stamp ?? "" });
                }}
              />
            }
            mode={page}
            end={end}
            filter={f}
            meta={meta}
          />
        ) : page === "apm" && trace ? (
          <>
            <button type="button" onClick={() => navigate({ trace: "" })}>
              スパン一覧へ
            </button>
            <Trace id={trace} />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                const metric =
                  url.get("metric") || meta.metrics[0] || "memory.current";
                const measure =
                  page === "metrics"
                    ? "metric"
                    : page === "logs"
                      ? "logs"
                      : "requests";
                setIncoming({
                  ...blankPanel,
                  ...f,
                  measure,
                  conditions: logContains
                    ? [{ field: "log", contains: logContains }]
                    : undefined,
                  metric: measure === "metric" ? metric : "",
                  title:
                    measure === "metric"
                      ? metric
                      : measure === "logs"
                        ? "ログ件数"
                        : "リクエスト数",
                });
                navigate({ page: "dashboards" });
              }}
            >
              この表示をダッシュボードに追加
            </button>
            {page === "metrics" && (
              <MetricChart
                meta={meta}
                filter={f}
                end={end}
                name={url.get("metric") ?? ""}
              />
            )}
            {logContains && (
              <div className="tools">
                <span>ログ本文に含む文字列：{logContains}</span>
                <button
                  type="button"
                  onClick={() => navigate({ logContains: "" })}
                >
                  本文条件を外す
                </button>
              </div>
            )}
            <Explorer
              key={page + JSON.stringify(f) + end + (logContains ?? "")}
              logContains={logContains}
              f={f}
              end={end}
              kind={
                page === "logs" ? "log" : page === "metrics" ? "metric" : "span"
              }
              showTrace={showTrace}
            />
          </>
        )}
      </main>
    </div>
  );
}
function MetricChart({
  meta,
  name,
  filter,
  end,
}: {
  meta: Overview;
  name: string;
  filter: Filter;
  end: string;
}) {
  const metric = name || meta.metrics[0];
  return metric ? (
    <>
      <Select
        label="表示するメトリクス"
        value={metric}
        choices={meta.metrics.map((m) => [m, m])}
        change={(v) => navigate({ metric: v })}
      />
      <PanelView
        end={end}
        panel={{
          ...blankPanel,
          ...filter,
          measure: "metric",
          metric,
          title: metric,
        }}
      />
    </>
  ) : null;
}
