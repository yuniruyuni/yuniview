import { useId, useState } from "react";
import type { Overview, Panel, Point } from "../../../shared/console";
import {
  axes,
  changeGroup,
  defaultTotalSlots,
  measures,
  slotTotalChoice,
} from "../../../shared/console";
import { clock, Feedback, number, useQuery } from "../api";

export function Select({
  label,
  value,
  choices,
  onDrop,
  dropTarget,
  change,
}: {
  label: string;
  value: string;
  choices: [string, string][];
  dropTarget?: string;
  onDrop?: React.DragEventHandler<HTMLSelectElement>;
  change: (v: string) => void;
}) {
  return (
    <label data-drop={dropTarget}>
      {label}
      <select
        onDrop={onDrop}
        onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
        value={value}
        onChange={(e) => change(e.target.value)}
      >
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
        choices={Object.entries(measures).filter(([k]) => k !== "distinct")}
        change={(v) =>
          set({
            ...p,
            measure: v as Panel["measure"],
            group: p.group === "slot_total" ? "source" : p.group,
            unit: undefined,
          })
        }
      />
      {p.measure === "metric" && (
        <>
          <label>
            メトリクス名
            <input
              required
              list="metric-options"
              value={p.metric}
              onChange={(e) =>
                set({ ...p, metric: e.target.value, unit: undefined })
              }
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
              ...(p.group === "slot_total"
                ? []
                : [["sum", "合計"] as [string, string]]),
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
      {p.group !== "slot_total" && (
        <Select
          label="系"
          value={p.slot}
          choices={choices(meta.slots)}
          change={(v) => update("slot", v)}
        />
      )}
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
          disabled={p.group === "slot_total"}
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
          ...(p.measure === "metric" ? [slotTotalChoice] : []),
          ["source", "サービス"],
          ["slot", "系"],
          ["revision", "リビジョン"],
          ["workload", "ワークロード"],
          ["instance", "インスタンス"],
        ]}
        change={(v) => set(changeGroup(p, v as Panel["group"]))}
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
  formatTime = clock,
  gapMs = Infinity,
  points,
  start,
  end,
  choose,
}: {
  gapMs?: number;
  formatTime?: (stamp: string) => string;
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
              <path
                fill="none"
                strokeWidth="2"
                d={ps
                  .map((p, i) => {
                    const move =
                      !i ||
                      Date.parse(p.bucket) - Date.parse(ps[i - 1].bucket) >
                        gapMs;
                    return `${move ? "M" : "L"}${x(p)},${y(p)}`;
                  })
                  .join(" ")}
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
                      {formatTime(p.bucket)} · {g} · {number(p.value)}
                    </title>
                  </circle>
                );
                return choose ? (
                  <a
                    key={p.bucket}
                    href={choose(p)}
                    aria-label={`${formatTime(p.bucket)} のログ`}
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
        <span>{formatTime(new Date(start).toISOString())}</span>
        <span>{formatTime(new Date(end).toISOString())}</span>
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
  onEdit,
  choose,
}: {
  panel: Panel;
  end: string;
  actions?: React.ReactNode;
  onEdit?: () => void;
  choose?: (p: Point) => string;
}) {
  const { data, error } = useQuery<Point[]>("series", {
    panel: { ...panel, title: "プレビュー" },
    end,
    buckets: panel.display === "chart",
  });
  return (
    <article className="card">
      <div className="cardhead">
        <h3>
          {onEdit ? (
            <button
              type="button"
              className="panel-title"
              aria-label={`${panel.title} を編集`}
              onClick={onEdit}
            >
              {panel.title}
            </button>
          ) : (
            panel.title
          )}
        </h3>
        {actions}
      </div>
      <small>
        {measures[panel.measure]} · {panel.source || "全サービス"} ·{" "}
        {panel.minutes}分 {panel.unit ?? ""}
        {panel.group === "slot_total" &&
          ` · ${(panel.totalSlots ?? defaultTotalSlots).join(" + ")}（全スロットを観測した分のみ）`}
      </small>
      {!data ? (
        <p role="status">
          <Feedback error={error} />
        </p>
      ) : data.length === 0 ? (
        <p className="empty">
          {["requests", "errors", "latency"].includes(panel.measure)
            ? "この条件で受信した server span がありません。期間またはサービスを変更してください。"
            : "この期間と絞り込み条件に一致するデータがありません。"}
        </p>
      ) : panel.display === "pivot" && panel.pivot ? (
        <PivotTable panel={panel} points={data} end={end} />
      ) : panel.display === "chart" ? (
        <Chart
          points={data}
          gapMs={
            panel.group === "slot_total"
              ? Math.ceil(panel.minutes / 40) * 60000
              : undefined
          }
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

export function investigatePanel(p: Panel, end: string) {
  return (
    "#" +
    new URLSearchParams({
      page:
        p.measure === "distinct"
          ? p.distinct?.dataset === "log"
            ? "logs"
            : "apm"
          : p.measure === "logs"
            ? "logs"
            : p.measure === "metric"
              ? "metrics"
              : "apm",
      source: p.source,
      slot: p.slot,
      instance: p.instance,
      workload: p.workload,
      revision: p.revision,
      text: p.text,
      minutes: String(p.minutes),
      metric: p.metric,
      end,
    }).toString()
  );
}
function PivotTable({
  panel,
  points,
  end,
}: {
  panel: Panel;
  points: Point[];
  end: string;
}) {
  const pivot = panel.pivot;
  if (!pivot) return null;
  const rows = new Map<string, Map<string, Point>>();
  const columns = new Set<string>();
  for (const point of points) {
    const col = point.column ?? "";
    columns.add(col);
    if (!rows.has(point.series)) rows.set(point.series, new Map());
    rows.get(point.series)?.set(col, point);
  }
  if (rows.size * columns.size > 4000)
    return <p>表が大きすぎます。期間またはサービスを絞ってください。</p>;
  const cols = Array.from(columns).sort();
  const cellLink = (row: string, col: string) => {
    const p = { ...panel };
    let until = end;
    for (const [axis, val] of [
      [pivot.row, row],
      [pivot.column, col],
    ] as const) {
      if (axis === "day") {
        const next = Date.parse(`${val}T00:00:00+09:00`) + 86400000 - 1;
        until = new Date(Math.min(next, Date.parse(end))).toISOString();
        p.minutes = Math.max(
          1,
          Math.ceil(
            (Date.parse(until) -
              Math.max(
                next - 86400000,
                Date.parse(end) - panel.minutes * 60000,
              )) /
              60000,
          ),
        );
      } else p[axis] = val;
    }
    return investigatePanel(p, until);
  };
  return (
    <div className="pivot-scroll">
      <table>
        <thead>
          <tr>
            <th>
              {axes[pivot.row]} ／ {axes[pivot.column]}
            </th>
            {cols.map((c) => (
              <th key={c}>{c || "未指定"}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(rows, ([r, cells]) => (
            <tr key={r}>
              <th scope="row">{r || "未指定"}</th>
              {cols.map((c) => {
                const p = cells.get(c);
                return (
                  <td key={c}>
                    {p && panel.distinct?.dataset === "daily" ? (
                      number(p.value)
                    ) : p ? (
                      <a href={cellLink(r, c)} aria-label={`${r} ${c} の詳細`}>
                        {number(p.value)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
