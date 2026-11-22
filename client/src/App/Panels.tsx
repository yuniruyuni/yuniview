import { useId, useState } from "react";
import type { Overview, Panel, Point } from "../../../shared/console";
import { measures } from "../../../shared/console";
import { clock, Feedback, number, useQuery } from "../api";

export function Select({
  label,
  value,
  choices,
  change,
}: {
  label: string;
  value: string;
  choices: [string, string][];
  change: (v: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => change(e.target.value)}>
        {choices.map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PanelFields({
  p,
  set,
  meta,
}: {
  p: Panel;
  set: (p: Panel) => void;
  meta: Overview;
}) {
  const update = <K extends keyof Panel>(key: K, value: Panel[K]) =>
    set({ ...p, [key]: value });
  const choices = (opts: string[]): [string, string][] => [
    ["", "すべて"],
    ...opts.map((s): [string, string] => [s, s]),
  ];
  return (
    <div className="fields">
      <label>
        パネル名
        <input
          required
          maxLength={512}
          value={p.title}
          onChange={(e) => update("title", e.target.value)}
        />
      </label>
      <Select
        label="指標"
        value={p.measure}
        choices={Object.entries(measures)}
        change={(v) => update("measure", v as Panel["measure"])}
      />
      {p.measure === "metric" && (
        <>
          <label>
            メトリクス名
            <input
              required
              list="metric-options"
              value={p.metric}
              onChange={(e) => update("metric", e.target.value)}
            />
            <datalist id="metric-options">
              {meta.metrics.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </datalist>
          </label>
          <Select
            label="集計"
            value={p.aggregation}
            choices={[
              ["avg", "平均"],
              ["max", "最大"],
              ["min", "最小"],
              ["sum", "合計"],
            ]}
            change={(v) => update("aggregation", v as Panel["aggregation"])}
          />
        </>
      )}
      <Select
        label="サービス"
        value={p.source}
        choices={choices(meta.services.map((s) => s.source))}
        change={(v) => update("source", v)}
      />
      <Select
        label="系"
        value={p.slot}
        choices={choices(meta.slots)}
        change={(v) => update("slot", v)}
      />
      <label>
        ワークロード
        <input
          value={p.workload}
          onChange={(e) => update("workload", e.target.value)}
        />
      </label>
      <label>
        インスタンス
        <input
          value={p.instance}
          onChange={(e) => update("instance", e.target.value)}
        />
      </label>
      <label>
        リビジョン
        <input
          value={p.revision}
          onChange={(e) => update("revision", e.target.value)}
        />
      </label>
      <label>
        検索語
        <input
          value={p.text}
          onChange={(e) => update("text", e.target.value)}
        />
      </label>
      <label>
        時間幅（分）
        <input
          type="number"
          required
          min={1}
          max={43200}
          value={p.minutes}
          onChange={(e) => update("minutes", Number(e.target.value))}
        />
      </label>
      <Select
        label="グループ"
        value={p.group}
        choices={[
          ["all", "全体"],
          ["source", "サービス"],
          ["slot", "系"],
          ["revision", "リビジョン"],
          ["workload", "ワークロード"],
          ["instance", "インスタンス"],
        ]}
        change={(v) => update("group", v as Panel["group"])}
      />
      <Select
        label="表示"
        value={p.display}
        choices={[
          ["chart", "折れ線"],
          ["value", "数値"],
          ["table", "表"],
        ]}
        change={(v) => update("display", v as Panel["display"])}
      />
    </div>
  );
}
const colors = [
  "#007f84",
  "#d47937",
  "#7461a8",
  "#357aa8",
  "#a34e75",
  "#6b852c",
];
export function Chart({
  points,
  start,
  end,
  choose,
}: {
  points: Point[];
  start: number;
  end: number;
  choose?: (p: Point) => string;
}) {
  const id = useId();
  const groups = Array.from(new Set(points.map((p) => p.series)));
  const [active, setActive] = useState("");
  const shown = points.filter((p) => !active || p.series === active);
  const low = shown.reduce((v, p) => Math.min(v, p.value), 0);
  const high = shown.reduce((v, p) => Math.max(v, p.value), low + 1);
  const x = (p: Point) =>
    Math.max(
      45,
      Math.min(
        595,
        45 + (550 * (Date.parse(p.bucket) - start)) / (end - start),
      ),
    );
  const y = (p: Point) => 135 - (112 * (p.value - low)) / (high - low);
  return (
    <>
      <svg viewBox="0 0 610 155" role="img" aria-labelledby={id}>
        <title id={id}>集計値の推移</title>
        {[0, 0.5, 1].map((n) => (
          <g key={n}>
            <line
              x1="45"
              x2="595"
              y1={135 - 112 * n}
              y2={135 - 112 * n}
              stroke="#dae5e3"
            />
            <text x="40" y={138 - 112 * n} textAnchor="end">
              {number(low + n * (high - low))}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const ps = shown.filter((p) => p.series === g);
          return (
            <g key={g} stroke={colors[i % colors.length]}>
              <polyline
                fill="none"
                strokeWidth="2"
                points={ps.map((p) => `${x(p)},${y(p)}`).join(" ")}
              />
              {ps.map((p) => {
                const mark = (
                  <circle
                    key={p.bucket}
                    cx={x(p)}
                    cy={y(p)}
                    r="3"
                    fill={colors[i % colors.length]}
                  >
                    <title>
                      {clock(p.bucket)} · {g} · {number(p.value)}
                    </title>
                  </circle>
                );
                return choose ? (
                  <a
                    key={p.bucket}
                    href={choose(p)}
                    aria-label={`${clock(p.bucket)} のログ`}
                  >
                    {mark}
                  </a>
                ) : (
                  mark
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="range">
        <span>{clock(new Date(start).toISOString())}</span>
        <span>{clock(new Date(end).toISOString())}</span>
      </div>
      <div className="legend">
        {groups.map((g, i) => (
          <button
            type="button"
            key={g}
            style={{ borderLeftColor: colors[i % colors.length] }}
            aria-pressed={active === g}
            onClick={() => setActive(active === g ? "" : g)}
          >
            {g || "未指定"}
          </button>
        ))}
      </div>
    </>
  );
}
export function PanelView({
  panel,
  end,
  actions,
  choose,
}: {
  panel: Panel;
  end: string;
  actions?: React.ReactNode;
  choose?: (p: Point) => string;
}) {
  const { data, error } = useQuery<Point[]>("series", {
    panel,
    end,
    buckets: panel.display === "chart",
  });
  return (
    <article className="card">
      <div className="cardhead">
        <h3>{panel.title}</h3>
        {actions}
      </div>
      <small>
        {measures[panel.measure]} · {panel.source || "全サービス"} ·{" "}
        {panel.minutes}分
      </small>
      {!data ? (
        <p role="status">
          <Feedback error={error} />
        </p>
      ) : data.length === 0 ? (
        <p className="empty">この期間のデータはありません</p>
      ) : panel.display === "chart" ? (
        <Chart
          points={data}
          start={Date.parse(end) - panel.minutes * 60000}
          end={Date.parse(end)}
          choose={choose}
        />
      ) : panel.display === "value" ? (
        <div className="values">
          {data.map((p) => (
            <div key={p.series}>
              <strong>{number(p.value)}</strong>
              <small>{p.series}</small>
            </div>
          ))}
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>系列</th>
              <th>値</th>
              <th>サンプル</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.series}>
                <td>{p.series}</td>
                <td>{number(p.value)}</td>
                <td>{p.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
