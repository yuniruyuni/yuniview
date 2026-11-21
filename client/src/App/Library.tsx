import { useState } from "react";
import {
  blankPanel,
  type Dashboard,
  type Filter,
  type Monitor,
  type MonitorRow,
  type Overview,
  type Panel,
  type Transition,
} from "../../../shared/console";
import { clock, Feedback, number, rpc, useQuery } from "../api";
import { PanelFields, PanelView, Select } from "./Panels";

interface LibraryData {
  dashboards: Dashboard[];
  monitors: MonitorRow[];
  history: Transition[];
  webhook: boolean;
}
const states: Record<string, string> = {
  pending: "評価待ち",
  ok: "正常",
  alert: "発報",
  no_data: "データなし",
};
function makeMonitor(p: Panel): Monitor {
  return {
    id: crypto.randomUUID(),
    title: p.title,
    panel: { ...p },
    threshold: 1,
    minimum: 1,
    operator: "above",
    notify: false,
    missing: "no_data",
  };
}
export function Library({
  mode,
  meta,
  end,
  filter,
}: {
  mode: "dashboards" | "monitors";
  meta: Overview;
  end: string;
  filter: Filter;
}) {
  const [revision, refresh] = useState(0);
  const result = useQuery<LibraryData>(
    "library",
    undefined,
    revision + Date.parse(end),
  );
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, select] = useState("");
  const [error, fail] = useState("");
  const [busy, working] = useState(false);
  const data = result.data;
  const start = (d: Dashboard) => {
    setDashboard(structuredClone(d));
    setIndex(0);
    fail("");
  };
  const seed = { ...blankPanel, ...filter };
  async function save(name: string, item: unknown) {
    working(true);
    fail("");
    try {
      await rpc(name, item, true);
      if (dashboard) select(dashboard.id);
      setDashboard(null);
      setMonitor(null);
      refresh((v) => v + 1);
    } catch (e) {
      fail(String(e));
    } finally {
      working(false);
    }
  }
  const remove = (kind: string, id: string) => {
    if (window.confirm("削除しますか？")) void save("remove", { kind, id });
  };
  const active =
    data?.dashboards.find((d) => d.id === selected) ?? data?.dashboards[0];
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {dashboard || monitor ? (
        <form
          className="editor card"
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              dashboard ? "saveDashboard" : "saveMonitor",
              dashboard ?? monitor,
            );
          }}
        >
          <h3>{dashboard ? "ダッシュボード編集" : "モニター編集"}</h3>
          <label>
            名前
            <input
              required
              maxLength={512}
              value={(dashboard ?? monitor)?.title}
              onChange={(e) =>
                dashboard
                  ? setDashboard({ ...dashboard, title: e.target.value })
                  : monitor && setMonitor({ ...monitor, title: e.target.value })
              }
            />
          </label>
          {dashboard && (
            <div className="tools">
              <Select
                label="編集するパネル"
                value={String(index)}
                choices={dashboard.panels.map((p, i) => [String(i), p.title])}
                change={(v) => setIndex(Number(v))}
              />
              <button
                type="button"
                disabled={dashboard.panels.length >= 24}
                onClick={() => {
                  setIndex(dashboard.panels.length);
                  setDashboard({
                    ...dashboard,
                    panels: [
                      ...dashboard.panels,
                      { ...seed, id: crypto.randomUUID() },
                    ],
                  });
                }}
              >
                パネル追加
              </button>
              <button
                type="button"
                disabled={dashboard.panels.length === 1}
                onClick={() => {
                  setDashboard({
                    ...dashboard,
                    panels: dashboard.panels.filter((_, i) => i !== index),
                  });
                  setIndex(0);
                }}
              >
                パネル削除
              </button>
            </div>
          )}
          <PanelFields
            meta={meta}
            p={dashboard ? dashboard.panels[index] : (monitor as Monitor).panel}
            set={(p) =>
              dashboard
                ? setDashboard({
                    ...dashboard,
                    panels: dashboard.panels.map((item, i) =>
                      i === index ? p : item,
                    ),
                  })
                : monitor && setMonitor({ ...monitor, panel: p })
            }
          />
          {monitor && (
            <div className="fields">
              <Select
                label="条件"
                choices={[
                  ["above", "より大きい"],
                  ["below", "より小さい"],
                ]}
                value={monitor.operator}
                change={(v) =>
                  setMonitor({ ...monitor, operator: v as Monitor["operator"] })
                }
              />
              <label>
                閾値
                <input
                  required
                  type="number"
                  step="any"
                  value={monitor.threshold}
                  onChange={(e) =>
                    setMonitor({
                      ...monitor,
                      threshold: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                最低サンプル数
                <input
                  required
                  type="number"
                  min={1}
                  value={monitor.minimum}
                  onChange={(e) =>
                    setMonitor({ ...monitor, minimum: Number(e.target.value) })
                  }
                />
              </label>
              <Select
                label="欠測時"
                choices={[
                  ["no_data", "データなし"],
                  ["alert", "発報"],
                ]}
                value={monitor.missing}
                change={(v) =>
                  setMonitor({ ...monitor, missing: v as Monitor["missing"] })
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={monitor.notify}
                  disabled={!data?.webhook}
                  onChange={(e) =>
                    setMonitor({ ...monitor, notify: e.target.checked })
                  }
                />
                Webhook 通知{!data?.webhook && "（未設定）"}
              </label>
            </div>
          )}
          <div className="tools">
            <button type="submit" className="primary" disabled={busy}>
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setDashboard(null);
                setMonitor(null);
                fail("");
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      ) : !data ? (
        <p>
          <Feedback error={result.error} />
        </p>
      ) : mode === "dashboards" ? (
        <>
          <div className="tools">
            <button
              type="button"
              className="primary"
              onClick={() =>
                start({
                  id: crypto.randomUUID(),
                  title: "新しいダッシュボード",
                  panels: [{ ...seed, id: crypto.randomUUID() }],
                })
              }
            >
              ダッシュボードを作成
            </button>
            {active && (
              <>
                <Select
                  label="ダッシュボード"
                  value={active.id}
                  choices={data.dashboards.map((d) => [d.id, d.title])}
                  change={select}
                />
                <button type="button" onClick={() => start(active)}>
                  編集
                </button>
                <button
                  type="button"
                  onClick={() => remove("dashboard", active.id)}
                >
                  削除
                </button>
              </>
            )}
          </div>
          {active ? (
            <>
              <h2>{active.title}</h2>
              <div className="cards">
                {active.panels.map((p) => (
                  <PanelView
                    key={p.id ?? p.title}
                    panel={p}
                    end={end}
                    actions={
                      <div className="tools">
                        <a
                          className="investigate"
                          href={`#${new URLSearchParams({ page: p.measure === "logs" ? "logs" : p.measure === "metric" ? "metrics" : "apm", source: p.source, slot: p.slot, revision: p.revision, workload: p.workload, instance: p.instance, minutes: String(p.minutes), text: p.text, metric: p.metric, end }).toString()}`}
                        >
                          調査
                        </a>
                        <button
                          type="button"
                          onClick={() => setMonitor(makeMonitor(p))}
                        >
                          モニター化
                        </button>
                      </div>
                    }
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="empty">
              保存したダッシュボードがここに表示されます。
            </p>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="primary"
            onClick={() => setMonitor(makeMonitor(seed))}
          >
            モニターを作成
          </button>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  {["モニター", "状態", "直近の値", "評価時刻", "操作"].map(
                    (v) => (
                      <th key={v}>{v}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.monitors.map((m) => (
                  <tr key={m.definition.id}>
                    <th>{m.definition.title}</th>
                    <td>
                      <span className={`state ${m.state}`}>
                        {states[m.state]}
                      </span>
                    </td>
                    <td>{number(m.value)}</td>
                    <td>{m.evaluated ? clock(m.evaluated) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setMonitor(structuredClone(m.definition))
                        }
                      >
                        編集
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => remove("monitor", m.definition.id)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.monitors.length && (
              <p className="empty">モニターはまだありません。</p>
            )}
          </div>
          <h3>状態の変化</h3>
          <div className="card scroll">
            <table>
              <thead>
                <tr>
                  <th>時刻</th>
                  <th>モニター</th>
                  <th>状態</th>
                  <th>値</th>
                  <th>通知</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td>{clock(h.at)}</td>
                    <td>{h.title}</td>
                    <td>{states[h.state]}</td>
                    <td>{number(h.value)}</td>
                    <td>
                      {
                        { off: "オフ", pending: "送信待ち", sent: "送信済み" }[
                          h.delivery
                        ]
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
