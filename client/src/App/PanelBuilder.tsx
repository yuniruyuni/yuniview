import { useState } from "react";
import {
  type Axis,
  axes,
  blankPanel,
  isUsage,
  measures,
  type Overview,
  type Panel,
} from "../../../shared/console";
import { PanelView, Select } from "./Panels";

type Props = { p: Panel; set: (p: Panel) => void; meta: Overview; end: string };
const dimensions = Object.entries(axes) as [Axis, string][];
function metricName(name: string) {
  return name === "memory.current"
    ? "メモリ使用量"
    : name === "cpu.usage"
      ? "CPU 使用時間（累積）"
      : name;
}
export function PanelBuilder({ p, set, meta, end }: Props) {
  const [search, find] = useState("");
  const [undo, remember] = useState<Panel[]>([]);
  function change(next: Panel) {
    remember((items) => [...items.slice(-25), p]);
    set(next);
  }
  const usage = isUsage(p.measure);
  const pivot = p.display === "pivot" && p.pivot;
  const fields = dimensions.filter(
    ([key]) => !usage || key === "day" || key === "source",
  );
  const metrics = Array.from(
    new Set([
      "memory.current",
      ...meta.metrics,
      ...(p.metric ? [p.metric] : []),
    ]),
  );
  const choices: [string, string][] = [
    ...metrics.map((m): [string, string] => [`metric/${m}`, metricName(m)]),
    ...Object.entries(measures).filter(([k]) => k !== "metric"),
  ];
  const selected = p.measure === "metric" ? `metric/${p.metric}` : p.measure;
  function pick(key: string) {
    const metric = key.startsWith("metric/") ? key.slice(7) : "";
    const measure = metric ? "metric" : (key as Panel["measure"]);
    const name = choices.find(([v]) => v === key)?.[1] ?? key;
    const oldName = choices.find(([v]) => v === selected)?.[1];
    const next: Panel = {
      ...p,
      title:
        !p.title || p.title === oldName || p.title === blankPanel.title
          ? name
          : p.title,
      metric,
      measure,
      unit: metric === "memory.current" ? "MiB" : undefined,
    };
    if (isUsage(measure))
      Object.assign(next, {
        display: "pivot",
        pivot: { row: "day", column: "source" },
        minutes: 43200,
        slot: "",
        revision: "",
        instance: "",
        workload: "",
        text: "",
      });
    else if (usage)
      Object.assign(next, { display: "chart", pivot: undefined, minutes: 60 });
    change(next);
  }
  function setAxis(which: "row" | "column", key: Axis) {
    const pair = { ...(p.pivot ?? { row: "source", column: "slot" }) };
    const other = which === "row" ? "column" : "row";
    if (pair[other] === key) pair[other] = pair[which];
    pair[which] = key;
    change({ ...p, display: "pivot", pivot: pair });
  }
  function drop(e: React.DragEvent, action: (key: Axis) => void) {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain");
    if (fields.some(([k]) => k === key)) action(key as Axis);
  }
  const update = <K extends keyof Panel>(key: K, value: Panel[K]) =>
    change({ ...p, [key]: value });
  const [filterKey, filterBy] = useState<Axis | "text">("source");
  const fieldKeys = usage
    ? (["source"] as const)
    : (["source", "slot", "workload", "revision", "instance", "text"] as const);
  const active = fieldKeys.filter((k) => p[k] || k === filterKey);
  const times = Array.from(
    new Set([
      ...(usage ? [1440, 10080, 43200] : [5, 15, 60, 180, 360, 1440, 10080]),
      p.minutes,
    ]),
  ).sort((a, b) => a - b);
  return (
    <div className="builder">
      <div className="field-catalog">
        <label>
          フィールドを検索
          <input
            type="search"
            value={search}
            onChange={(e) => find(e.target.value)}
            placeholder="名前・メトリクス名"
          />
        </label>
        <h4>指標</h4>
        {choices
          .filter(([k, v]) =>
            (k + v).toLowerCase().includes(search.toLowerCase()),
          )
          .map(([k, v]) => (
            <button
              type="button"
              key={k}
              aria-pressed={selected === k}
              onClick={() => pick(k)}
            >
              {v}
            </button>
          ))}
        <h4>比較に使える項目</h4>
        <small>項目をクリックするか、右の選択欄にドラッグします。</small>
        {fields
          .filter(([k, v]) => (k + v).includes(search))
          .map(([k, v]) => (
            <button
              key={k}
              type="button"
              draggable
              onDragStart={(e) => e.dataTransfer.setData("text/plain", k)}
              onClick={() =>
                pivot
                  ? setAxis("row", k)
                  : k === "day"
                    ? setAxis("row", k)
                    : update("group", k)
              }
            >
              {v}
            </button>
          ))}
      </div>
      <div className="builder-main">
        <div className="fields">
          <Select
            label="指標"
            value={selected}
            choices={choices}
            change={pick}
          />
          <Select
            label="表示"
            value={p.display}
            choices={
              usage
                ? [["pivot", "ピボット表"]]
                : [
                    ["chart", "折れ線"],
                    ["table", "表"],
                    ["value", "数値"],
                    ["pivot", "ピボット表"],
                  ]
            }
            change={(v) =>
              change({
                ...p,
                display: v as Panel["display"],
                pivot:
                  v === "pivot" ? { row: "source", column: "slot" } : undefined,
              })
            }
          />
          {p.measure === "metric" && (
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
          )}
          <Select
            label="期間"
            value={String(p.minutes)}
            choices={times.map((m) => [
              String(m),
              m % 1440 === 0
                ? `${m / 1440}日`
                : m % 60 === 0
                  ? `${m / 60}時間`
                  : `${m}分`,
            ])}
            change={(v) => update("minutes", Number(v))}
          />
        </div>
        <div className="shelves">
          {pivot ? (
            (["row", "column"] as const).map((which) => (
              <Select
                key={which}
                onDrop={(e) => drop(e, (k) => setAxis(which, k))}
                label={which === "row" ? "行" : "列"}
                value={pivot[which]}
                choices={fields}
                change={(k) => setAxis(which, k as Axis)}
              />
            ))
          ) : (
            <Select
              onDrop={(e) =>
                drop(e, (k) =>
                  k === "day" ? setAxis("row", k) : update("group", k),
                )
              }
              label="系列"
              value={p.group}
              choices={[
                ["all", "全体"],
                ...fields.filter(([k]) => k !== "day"),
              ]}
              change={(k) => update("group", k as Panel["group"])}
            />
          )}
          <Select
            onDrop={(e) =>
              drop(e, (k) => {
                if (k !== "day") filterBy(k);
              })
            }
            label="絞り込みを追加"
            value=""
            choices={[
              ["", "項目を選択"],
              ...fieldKeys.map((k): [string, string] => [
                k,
                k === "text" ? "検索語" : axes[k],
              ]),
            ]}
            change={(v) => {
              if (v) filterBy(v as Axis | "text");
            }}
          />
          {active.map((k) => (
            <label key={k}>
              {k === "text" ? "検索語" : axes[k]}
              <input
                list={`builder-${k}`}
                value={p[k]}
                placeholder="すべて"
                onChange={(e) => update(k, e.target.value)}
              />
              <datalist id={`builder-${k}`}>
                {(k === "source"
                  ? meta.services.map((s) => s.source)
                  : k === "slot"
                    ? meta.slots
                    : k === "revision"
                      ? meta.revisions
                      : []
                ).map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </label>
          ))}
        </div>
        <div className="preview-head">
          <h4>プレビュー</h4>
          <button
            type="button"
            disabled={!undo.length}
            onClick={() => {
              const prev = undo.at(-1);
              if (prev) {
                set(prev);
                remember(undo.slice(0, -1));
              }
            }}
          >
            元に戻す
          </button>
        </div>
        <PanelView
          panel={{ ...p, title: p.title.trim() || "プレビュー" }}
          end={end}
        />
        <label>
          パネル名
          <input
            required
            maxLength={512}
            value={p.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
