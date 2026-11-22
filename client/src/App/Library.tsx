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
import { DashboardWorkspace } from "./DashboardWorkspace";
import { PanelFields, Select } from "./Panels";

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
  incoming,
  consumed,
}: {
  incoming: Panel | null;
  consumed: () => void;
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
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [error, fail] = useState("");
  const [busy, working] = useState(false);
  const data = result.data;
  const seed = { ...blankPanel, ...filter };
  async function save(name: string, item: unknown) {
    working(true);
    fail("");
    try {
      await rpc(name, item, true);
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
  if (mode === "dashboards" && !monitor)
    return (
      <DashboardWorkspace
        end={end}
        meta={meta}
        seed={seed}
        incoming={incoming}
        consumed={consumed}
        monitor={(p) => setMonitor(makeMonitor(p))}
      />
    );
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {monitor ? (
        <form
          className="editor card"
          onSubmit={(e) => {
            e.preventDefault();
            void save("saveMonitor", monitor);
          }}
        >
          <h3>モニター編集</h3>
          <label>
            名前
            <input
              required
              maxLength={512}
              value={monitor.title}
              onChange={(e) =>
                setMonitor({ ...monitor, title: e.target.value })
              }
            />
          </label>
          <PanelFields
            meta={meta}
            p={monitor.panel}
            set={(panel) => setMonitor({ ...monitor, panel })}
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
                閾値 {monitor.panel.unit}
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
