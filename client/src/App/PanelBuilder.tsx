import { useState } from "react";
import {
  type Axis,
  axes,
  blankPanel,
  changeGroup,
  type Distinct,
  defaultTotalSlots,
  measures,
  type Overview,
  type Panel,
  slotTotalChoice,
} from "../../../shared/console";
import { PanelView, Select } from "./Panels";
import { useDropPreview } from "./useDropPreview";

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
  const selection = p.measure === "distinct" ? p.distinct : undefined;
  const daily = selection?.dataset === "daily";
  const pivot = p.display === "pivot" && p.pivot;
  const fields = dimensions.filter(
    ([key]) => !daily || key === "day" || key === "source",
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
  function withDataset(panel: Panel, dataset: Distinct["dataset"]): Panel {
    const field = dataset === "daily" ? (meta.dailyFields[0] ?? "") : "";
    const next = { ...panel, distinct: { dataset, field } };
    if (dataset !== "daily") return next;
    return {
      ...next,
      display: "pivot",
      pivot: { row: "day", column: "source" },
      group: "source",
      minutes: 43200,
      slot: "",
      workload: "",
      revision: "",
      instance: "",
      text: "",
    };
  }
  function picked(key: string): Panel {
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
      distinct: undefined,
      group:
        p.group === "slot_total" && measure !== "metric" ? "source" : p.group,
      measure,
      unit: metric === "memory.current" ? "MiB" : undefined,
    };
    if (measure === "distinct")
      return withDataset(next, meta.dailyFields.length ? "daily" : "log");
    if (daily)
      Object.assign(next, { display: "chart", pivot: undefined, minutes: 60 });
    return next;
  }
  function pick(key: string) {
    change(picked(key));
  }
  function axisPanel(which: "row" | "column", key: Axis) {
    const pair = {
      ...(p.pivot ??
        (daily
          ? { row: "day", column: "source" }
          : { row: "source", column: "slot" })),
    };
    const other = which === "row" ? "column" : "row";
    if (pair[other] === key) pair[other] = pair[which];
    pair[which] = key;
    return {
      ...p,
      group: p.group === "slot_total" ? "source" : p.group,
      display: "pivot" as const,
      pivot: pair,
    };
  }
  function setAxis(which: "row" | "column", key: Axis) {
    change(axisPanel(which, key));
  }
  function drop(e: React.DragEvent, action: (key: Axis) => void) {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/plain");
    if (fields.some(([k]) => k === key)) action(key as Axis);
  }
  const update = <K extends keyof Panel>(key: K, value: Panel[K]) =>
    change({ ...p, [key]: value });
  const [filterKey, filterBy] = useState<Axis | "text">("source");
  const fieldKeys = daily
    ? (["source"] as const)
    : p.group === "slot_total"
      ? (["source", "workload", "revision", "text"] as const)
      : ([
          "source",
          "slot",
          "workload",
          "revision",
          "instance",
          "text",
        ] as const);
  type Field =
    | { kind: "measure"; key: string }
    | { kind: "dimension"; key: Axis };
  function candidates(field: Field) {
    const options: {
      id: string;
      label: string;
      panel?: Panel;
      filter?: Axis;
    }[] = [];
    if (field.kind === "measure")
      return [
        { id: "measure", label: "指標", panel: picked(field.key) },
      ] as typeof options;
    const key = field.key;
    if (!daily && key !== "day")
      options.push({
        id: "series",
        label: "系列",
        panel: {
          ...p,
          display: pivot ? "chart" : p.display,
          pivot: undefined,
          group: key,
        },
      });
    options.push(
      { id: "row", label: "ピボットの行", panel: axisPanel("row", key) },
      { id: "column", label: "ピボットの列", panel: axisPanel("column", key) },
    );
    if (key !== "day" && fieldKeys.some((k) => k === key))
      options.push({ id: "filter", label: "絞り込み", filter: key });
    return options;
  }
  const drag = useDropPreview<Field>((field, id) => {
    const option = candidates(field).find((o) => o.id === id);
    if (option?.panel) change(option.panel);
    if (option?.filter) filterBy(option.filter);
  });
  const item = drag.preview?.item;
  const targets = item ? candidates(item) : [];
  const hovered = targets.find((o) => o.id === drag.preview?.target);
  const preview = hovered?.panel ?? p;
  const fieldName =
    item?.kind === "dimension"
      ? axes[item.key]
      : choices.find(([k]) => k === item?.key)?.[1];
  const active = fieldKeys.filter((k) => p[k] || k === filterKey);
  const times = Array.from(
    new Set([
      ...(daily ? [1440, 10080, 43200] : [5, 15, 60, 180, 360, 1440, 10080]),
      p.minutes,
    ]),
  ).sort((a, b) => a - b);
  return (
    <div className="builder" {...drag.bind}>
      {item && (
        <span className="drag-ghost" aria-hidden="true">
          {fieldName}
        </span>
      )}
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
              className="drag-source"
              onPointerDown={(e) => drag.start(e, { kind: "measure", key: k })}
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
              className="drag-source"
              onPointerDown={(e) =>
                drag.start(e, { kind: "dimension", key: k })
              }
              onClick={() =>
                daily && !pivot
                  ? setAxis("row", k)
                  : pivot
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
      {item && (
        <div className="field-drop-tray">
          <strong>{fieldName}</strong>
          <div>
            {targets.map((o) => (
              <span
                key={o.id}
                data-drop={o.id}
                data-preview={hovered?.id === o.id || undefined}
              >
                {o.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="builder-main">
        <div className="fields">
          <Select
            dropTarget="measure"
            label="指標"
            value={selected}
            choices={choices}
            change={pick}
          />
          {selection && (
            <>
              <Select
                label="集計対象"
                value={selection.dataset}
                choices={[
                  ["daily", "日次集合"],
                  ["log", "ログ属性"],
                  ["span", "スパン属性"],
                ]}
                change={(v) => {
                  change(withDataset(p, v as Distinct["dataset"]));
                }}
              />
              <label>
                {daily ? "集合名" : "属性キー"}
                <input
                  required
                  maxLength={256}
                  list={daily ? "daily-fields" : undefined}
                  value={selection.field}
                  onChange={(e) =>
                    change({
                      ...p,
                      distinct: {
                        dataset: selection.dataset,
                        field: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <datalist id="daily-fields">
                {meta.dailyFields.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </>
          )}
          <Select
            label="表示"
            value={p.display}
            choices={
              daily
                ? [
                    ["pivot", "ピボット表"],
                    ["chart", "折れ線"],
                  ]
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
                group:
                  v === "pivot" && p.group === "slot_total"
                    ? "source"
                    : p.group,
                pivot:
                  v === "pivot"
                    ? daily
                      ? { row: "day", column: "source" }
                      : { row: "source", column: "slot" }
                    : undefined,
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
                ...(p.group === "slot_total"
                  ? []
                  : [["sum", "合計"] as [string, string]]),
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
                dropTarget={which}
                label={which === "row" ? "行" : "列"}
                value={pivot[which]}
                choices={fields}
                change={(k) => setAxis(which, k as Axis)}
              />
            ))
          ) : daily ? (
            <span>系列：サービス</span>
          ) : (
            <Select
              onDrop={(e) =>
                drop(e, (k) =>
                  k === "day" ? setAxis("row", k) : update("group", k),
                )
              }
              dropTarget="series"
              label="系列"
              value={p.group}
              choices={[
                ["all", "全体"],
                ...(p.measure === "metric" ? [slotTotalChoice] : []),
                ...fields.filter(([k]) => k !== "day"),
              ]}
              change={(k) => change(changeGroup(p, k as Panel["group"]))}
            />
          )}
          {p.group === "slot_total" && (
            <fieldset>
              <legend>合計するスロット</legend>
              {Array.from(
                new Set([
                  ...(p.totalSlots ?? defaultTotalSlots),
                  ...meta.slots,
                ]),
              ).map((slot) => {
                const selected = p.totalSlots ?? defaultTotalSlots;
                return (
                  <label key={slot} className="inline">
                    <input
                      type="checkbox"
                      checked={selected.includes(slot)}
                      disabled={
                        selected.length === 1 && selected.includes(slot)
                      }
                      onChange={(e) =>
                        update(
                          "totalSlots",
                          e.target.checked
                            ? [...selected, slot]
                            : selected.filter((s) => s !== slot),
                        )
                      }
                    />
                    {slot}
                  </label>
                );
              })}
            </fieldset>
          )}
          <Select
            onDrop={(e) =>
              drop(e, (k) => {
                if (k !== "day") filterBy(k);
              })
            }
            dropTarget="filter"
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
          {hovered && (
            <h4>
              {fieldName} → {hovered.label}
            </h4>
          )}
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
        {hovered?.panel && (
          <PanelView
            panel={{ ...preview, title: preview.title.trim() || "プレビュー" }}
            end={end}
          />
        )}
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
