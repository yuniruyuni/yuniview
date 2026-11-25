import { useState } from "react";
import type {
  EventRow,
  FieldCondition,
  Filter,
  RouteRow,
} from "../../../shared/console";
import { clock, Feedback, number, useQuery } from "../api";

export function Explorer({
  kind,
  conditions,
  logContains,
  f,
  end,
  showTrace,
}: {
  kind: "event" | "span" | "log" | "metric";
  conditions?: FieldCondition[];
  logContains?: string;
  f: Filter;
  end: string;
  showTrace: (id: string) => void;
}) {
  const [offset, page] = useState(0);
  const [opened, open] = useState("");
  const { data, error } = useQuery<EventRow[]>("events", {
    ...f,
    conditions,
    logContains,
    end,
    kind,
    offset,
  });
  return (
    <>
      {kind === "span" && <Routes f={f} end={end} showTrace={showTrace} />}

      <h3>
        {
          {
            event: "イベント実行履歴",
            log: "ログストリーム",
            span: "直近のスパン",
            metric: "メトリクスサンプル",
          }[kind]
        }
      </h3>
      {!data ? (
        <p role="status">
          <Feedback error={error} />
        </p>
      ) : (
        <>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>サービス / 系</th>
                  <th>{kind === "log" ? "本文" : "名前"}</th>
                  <th>
                    {kind === "log"
                      ? "レベル"
                      : kind === "event"
                        ? "実行回数"
                        : "値"}
                  </th>
                  <th>詳細</th>
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 100).map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{clock(r.at)}</td>
                    <td>
                      {r.source}
                      <small>
                        {r.slot} {r.revision}
                      </small>
                    </td>
                    <td className="message">
                      {kind === "log" ? r.body : r.name}
                    </td>
                    <td>
                      {kind === "log" ? r.name : `${number(r.value)} ${r.unit}`}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => open(opened === r.id ? "" : r.id)}
                      >
                        属性
                      </button>{" "}
                      {r.trace && (
                        <button
                          type="button"
                          onClick={() => showTrace(r.trace)}
                        >
                          トレース
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && (
              <p className="empty">条件に一致するデータはありません。</p>
            )}
          </div>
          {opened && data.some((r) => r.id === opened) && (
            <pre>
              {JSON.stringify(
                data.find((r) => r.id === opened),
                null,
                2,
              )}
            </pre>
          )}
          <div className="tools">
            <button
              type="button"
              disabled={!offset}
              onClick={() => page(Math.max(0, offset - 100))}
            >
              前へ
            </button>
            <small>
              {offset + Math.min(1, data.length)}–
              {offset + Math.min(data.length, 100)}
            </small>
            <button
              type="button"
              disabled={data.length <= 100}
              onClick={() => page(offset + 100)}
            >
              次へ
            </button>
          </div>
        </>
      )}
    </>
  );
}
export function Trace({ id }: { id: string }) {
  const { data, error } = useQuery<EventRow[]>("trace", id);
  if (!data)
    return (
      <p>
        <Feedback error={error} />
      </p>
    );
  const list = data.slice(0, 2000),
    spans = list.filter((r) => r.kind === "span");
  const logs = list.filter((r) => r.kind === "log");
  const start = Math.min(...spans.map((r) => Date.parse(r.at)));
  const finish = Math.max(
    ...spans.map((r) => Date.parse(r.at) + (r.value ?? 0)),
  );
  const duration = Math.max(1, finish - start);
  const parents = new Map(spans.map((r) => [r.span, r.parent]));
  function depth(r: EventRow) {
    let parent = r.parent;
    const seen = new Set<string>();
    while (
      parent &&
      parents.has(parent) &&
      !seen.has(parent) &&
      seen.size < 12
    ) {
      seen.add(parent);
      parent = parents.get(parent) ?? "";
    }
    return seen.size;
  }
  return (
    <>
      <h3>スパンのタイムライン</h3>
      <code>{id}</code>
      <div className="card">
        {spans.map((r) => (
          <div key={r.id}>
            <div className="track">
              <i
                style={{
                  left: `${(100 * (Date.parse(r.at) - start)) / duration}%`,
                  width: `${Math.max(0.4, (100 * (r.value ?? 0)) / duration)}%`,
                }}
              />
            </div>
            <details>
              <summary>
                <span style={{ paddingLeft: depth(r) * 12 }}>
                  {r.source} · {r.body}
                </span>{" "}
                <b>{number(r.value)} ms</b>
              </summary>
              <pre>{JSON.stringify(r.attrs, null, 2)}</pre>
              <small>
                span {r.span} / parent {r.parent || "root"}
              </small>
            </details>
          </div>
        ))}
        {!spans.length && <p>スパンはありません。</p>}
      </div>
      <h3>関連ログ ({logs.length})</h3>
      <div className="card">
        {logs.map((r) => (
          <p key={r.id}>
            <small>
              {clock(r.at)} · {r.source}
            </small>
            {r.body}
          </p>
        ))}
        {!logs.length && <p>同じ trace ID のログはありません。</p>}
      </div>
      {data.length > 2000 && <p>先頭 2,000 件を表示しています。</p>}
    </>
  );
}

function Routes({
  f,
  end,
  showTrace,
}: {
  f: Filter;
  end: string;
  showTrace: (id: string) => void;
}) {
  const routeResult = useQuery<RouteRow[]>("routes", { ...f, end });
  return (
    <>
      {" "}
      <h3>ルート別の受信 server span</h3>
      <div className="card scroll">
        <table>
          <thead>
            <tr>
              {[
                "サービス",
                "ルート",
                "件数",
                "失敗数",
                "p95",
                "最も遅い要求",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routeResult.data?.map((r) => (
              <tr key={r.source + r.name}>
                <td>{r.source}</td>
                <td>{r.name}</td>
                <td>{r.requests}</td>
                <td>{r.errors}</td>
                <td>{number(r.p95)} ms</td>
                <td>
                  {r.trace && (
                    <button type="button" onClick={() => showTrace(r.trace)}>
                      トレースを開く
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!routeResult.data ? (
          <p>
            <Feedback error={routeResult.error} />
          </p>
        ) : (
          !routeResult.data.length && (
            <p className="empty">この期間の server span はありません。</p>
          )
        )}
      </div>
    </>
  );
}
