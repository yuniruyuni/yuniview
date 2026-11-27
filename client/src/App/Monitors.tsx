import { useState } from "react";
import type {
  Backtest,
  Monitor,
  MonitorRow,
  Overview,
  Panel,
  Transition,
} from "../../../shared/console";
import { clock, Feedback, number, rpc, useQuery } from "../api";
import { useDictionary } from "./dictionary";
import { nativeUnit, shownUnit } from "./fieldDisplay";
import { PanelBuilder } from "./PanelBuilder";
import { Select } from "./Panels";

interface LibraryData {
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
export function makeMonitor(p: Panel): Monitor {
  return {
    id: crypto.randomUUID(),
    title: p.title,
    panel: {
      ...p,
      display: "chart",
      pivot: undefined,
      values: p.values.slice(0, 1),
    },
    threshold: 1,
    minimum: 1,
    operator: "above",
    notify: false,
    missing: "no_data",
  };
}

function BacktestNote({ monitor, end }: { monitor: Monitor; end: string }) {
  const { data, error } = useQuery<Backtest>("backtest", { monitor, end });
  if (!data)
    return (
      <p className="backtest">
        <Feedback error={error} />
      </p>
    );
  return (
    <p className="backtest">
      この条件で過去{data.days}日を {monitor.panel.minutes}
      分ごとに判定すると、発報 {number(data.alert)} 回・正常 {number(data.ok)}{" "}
      回・データなし {number(data.noData)} 回
    </p>
  );
}

/** A monitor's query in the panel editor, with its rule beside the shelves. */
function MonitorEditor({
  initial,
  meta,
  end,
  timeControl,
  webhook,
  close,
}: {
  initial: Monitor;
  meta: Overview;
  end: string;
  timeControl: React.ReactNode;
  webhook: boolean;
  close: (saved: boolean) => void;
}) {
  const dict = useDictionary();
  const [monitor, setMonitor] = useState(initial);
  const [error, fail] = useState("");
  const [busy, working] = useState(false);
  const value = monitor.panel.values[0];
  const unit = shownUnit(
    dict,
    monitor.panel,
    value,
    nativeUnit(dict, monitor.panel, value),
  );
  async function save() {
    working(true);
    fail("");
    try {
      await rpc(
        "saveMonitor",
        { ...monitor, title: monitor.panel.title },
        true,
      );
      close(true);
    } catch (e) {
      fail((e as Error).message);
      working(false);
    }
  }
  const rule = (
    <fieldset className="monitor-rule" aria-label="判定">
      <legend>判定</legend>
      <Select
        label="比較"
        choices={[
          ["above", "閾値より大きいと発報"],
          ["below", "閾値より小さいと発報"],
        ]}
        value={monitor.operator}
        change={(v) =>
          setMonitor({ ...monitor, operator: v as Monitor["operator"] })
        }
      />
      <label>
        閾値（{unit}）
        <input
          required
          type="number"
          step="any"
          value={monitor.threshold}
          onChange={(e) =>
            setMonitor({ ...monitor, threshold: Number(e.target.value) })
          }
        />
      </label>
      <label>
        評価窓（分）
        <input
          required
          type="number"
          min={1}
          max={1440}
          value={monitor.panel.minutes}
          onChange={(e) =>
            setMonitor({
              ...monitor,
              panel: { ...monitor.panel, minutes: Number(e.target.value) },
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
          ["no_data", "データなしとして扱う"],
          ["alert", "発報する"],
        ]}
        value={monitor.missing}
        change={(v) =>
          setMonitor({ ...monitor, missing: v as Monitor["missing"] })
        }
      />
      <label className="inline">
        <input
          type="checkbox"
          checked={monitor.notify}
          disabled={!webhook}
          onChange={(e) => setMonitor({ ...monitor, notify: e.target.checked })}
        />
        Webhook 通知{!webhook && "（未設定）"}
      </label>
      <BacktestNote monitor={monitor} end={end} />
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
  return (
    <form className="editor" inert={busy} onSubmit={(e) => e.preventDefault()}>
      <section className="worksheet" aria-label="ワークシート">
        <PanelBuilder
          p={monitor.panel}
          set={(panel) => setMonitor({ ...monitor, panel })}
          meta={meta}
          end={end}
          minutes={Math.max(60, monitor.panel.minutes * 12)}
          timeControl={timeControl}
          savePanel={() => void save()}
          cancelPanel={() => close(false)}
          directSave
          actions={null}
          rule={rule}
          threshold={monitor.threshold}
        />
      </section>
    </form>
  );
}

/** Monitors, their latest state and their history of state changes. */
export function Monitors({
  meta,
  end,
  timeControl,
  incoming,
  consumed,
}: {
  meta: Overview;
  end: string;
  timeControl: React.ReactNode;
  incoming: Monitor | null;
  consumed: () => void;
}) {
  const [revision, refresh] = useState(0);
  const result = useQuery<LibraryData>(
    "library",
    undefined,
    revision + Date.parse(end),
  );
  const [editing, edit] = useState<Monitor | null>(null);
  const [error, fail] = useState("");
  const data = result.data;
  const current = incoming ?? editing;
  if (current)
    return (
      <MonitorEditor
        key={current.id}
        initial={current}
        meta={meta}
        end={end}
        timeControl={timeControl}
        webhook={!!data?.webhook}
        close={(saved) => {
          edit(null);
          consumed();
          if (saved) refresh((n) => n + 1);
        }}
      />
    );
  async function remove(id: string) {
    if (!window.confirm("このモニターを削除しますか？")) return;
    try {
      await rpc("remove", { kind: "monitor", id }, true);
      refresh((n) => n + 1);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p>
          <Feedback error={result.error} />
        </p>
      ) : (
        <>
          <div className="section-head">
            <h3>モニター</h3>
            <button
              type="button"
              className="primary"
              onClick={() =>
                edit(
                  makeMonitor({
                    title: "失敗率",
                    data: "request",
                    values: [{ agg: "ratio", of: ["failed"] }],
                    minutes: 5,
                    group: "source",
                    display: "chart",
                  }),
                )
              }
            >
              モニターを作成
            </button>
          </div>
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
                        onClick={() => edit(structuredClone(m.definition))}
                      >
                        編集
                      </button>{" "}
                      <button
                        type="button"
                        onClick={() => remove(m.definition.id)}
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
