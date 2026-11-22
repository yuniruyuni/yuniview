import { useState } from "react";
import {
  type Axis,
  axes,
  blankPanel,
  changeGroup,
  type Dimension,
  type Distinct,
  defaultTotalSlots,
  isAttribute,
  measures,
  type Overview,
  type Panel,
  type Pivot,
  type ShelfAxis,
  shelfName,
  slotTotalChoice,
} from "../../../shared/console";
import { useQuery } from "../api";
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
  const observed = useQuery<string[]>("worksheetAttributes", {
    source: p.source,
    kind:
      p.measure === "metric"
        ? "metric"
        : p.measure === "logs" || selection?.dataset === "log"
          ? "log"
          : "span",
    metric: p.metric,
    end,
    minutes: p.minutes,
  });
  const keys = new Set([
    ...(observed.data ?? []).map((k) => "attr:" + k),
    ...[p.group, p.pivot?.row, p.pivot?.column, p.pivot?.series].filter(
      (k) => k && isAttribute(k),
    ),
  ]);
  const fields: [Dimension, string][] = [
    ...dimensions.filter(
      ([key]) => !daily || key === "day" || key === "source",
    ),
  ];
  if (!daily)
    for (const key of keys)
      if (key && isAttribute(key)) fields.push([key, shelfName(key)]);
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
      pivot: p.pivot ? { ...p.pivot, metrics: undefined } : undefined,
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
  type Shelf = "row" | "column" | "series";
  const shelves: Shelf[] = ["row", "column", "series"];
  function assign(base: Panel, shelf: Shelf, field: ShelfAxis): Panel {
    const pair: Pivot = {
      ...(base.pivot ??
        (base.distinct?.dataset === "daily"
          ? { row: "day", column: "source" }
          : { row: "source", column: "slot" })),
    };
    const old = pair[shelf];
    const other = shelves.find((k) => k !== shelf && pair[k] === field);
    if (other) {
      if (old) pair[other] = old;
      else if (other === "series") delete pair.series;
      else
        pair[other] =
          dimensions.find(
            ([k]) => k !== field && k !== pair.row && k !== pair.column,
          )?.[0] ?? "day";
    }
    pair[shelf] = field;
    if (!shelves.some((k) => pair[k] === "measure")) delete pair.metrics;
    return {
      ...base,
      display: "pivot",
      group: base.group === "slot_total" ? "source" : base.group,
      pivot: pair,
    };
  }
  function placeMeasure(which: Shelf, key: string): Panel {
    const next = picked(key);
    if (
      key.startsWith("metric/") &&
      p.measure === "metric" &&
      pivot &&
      pivot[which] === "measure"
    ) {
      const names = new Set([p.metric, ...(pivot.metrics ?? [])]);
      names.add(next.metric);
      const extra = Array.from(names).slice(1, 13);
      return {
        ...p,
        unit: extra.length ? undefined : p.unit,
        pivot: { ...pivot, metrics: extra.length ? extra : undefined },
      };
    }
    return assign(next, which, "measure");
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
    | { kind: "dimension"; key: Dimension };
  function candidates(field: Field) {
    const options: {
      id: string;
      label: string;
      panel?: Panel;
      filter?: Axis;
    }[] = [];
    if (field.kind === "measure") {
      const base = picked(field.key);
      options.push({ id: "measure", label: "指標", panel: base });
      if (base.distinct?.dataset !== "daily")
        for (const id of shelves)
          options.push({
            id,
            label: { row: "行", column: "列", series: "系列" }[id],
            panel: placeMeasure(id, field.key),
          });
      return options;
    }
    const key = field.key;
    if (!daily || (key === "source" && !pivot)) {
      if (pivot)
        options.push({
          id: "series",
          label: "系列",
          panel: assign(p, "series", key),
        });
      else if (key !== "day")
        options.push({
          id: "series",
          label: "系列",
          panel: { ...p, group: key },
        });
    }
    options.push(
      { id: "row", label: "行", panel: assign(p, "row", key) },
      { id: "column", label: "列", panel: assign(p, "column", key) },
    );
    if (key !== "day" && fieldKeys.some((k) => k === key))
      options.push({ id: "filter", label: "絞り込み", filter: key as Axis });
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
      ? shelfName(item.key)
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
        <h4>属性</h4>
        <small>フィールドを行・列・系列にドラッグします。</small>
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
                  ? change(assign(p, "row", k))
                  : pivot
                    ? change(assign(p, "row", k))
                    : k === "day"
                      ? change(assign(p, "row", k))
                      : update("group", k)
              }
            >
              {v}
            </button>
          ))}
      </div>
      <div className="builder-main">
        <div className="worksheet-shelves">
          {shelves.map((id) => {
            const axis = pivot ? pivot[id] : undefined;
            const value =
              axis === "measure"
                ? selected
                : axis
                  ? "axis/" + axis
                  : !pivot && id === "series"
                    ? p.group === "all" || p.group === "slot_total"
                      ? p.group
                      : "axis/" + p.group
                    : "";
            const allowed = (f: Field) => {
              if (f.kind === "measure")
                return f.key !== "distinct" || !meta.dailyFields.length;
              if (id !== "series") return true;
              return daily
                ? !pivot && f.key === "source"
                : !!pivot || f.key !== "day";
            };
            const opts: [string, string][] = [
              [
                "",
                pivot
                  ? "未設定"
                  : id === "row"
                    ? "値"
                    : id === "column"
                      ? "時間 / カテゴリ"
                      : "未設定",
              ],
              ...(id === "series" && !pivot && !daily
                ? [
                    ["all", "全体"] as [string, string],
                    ...(p.measure === "metric" ? [slotTotalChoice] : []),
                  ]
                : []),
              ...fields
                .filter(([key]) => allowed({ kind: "dimension", key }))
                .map(([k, v]): [string, string] => ["axis/" + k, v]),
              ...choices.filter(([key]) => allowed({ kind: "measure", key })),
            ];
            return (
              <div
                key={id}
                data-drop={id}
                data-ready={
                  (item && targets.some((t) => t.id === id)) || undefined
                }
                data-preview={hovered?.id === id || undefined}
              >
                <Select
                  label={{ row: "行", column: "列", series: "系列" }[id]}
                  value={value}
                  choices={opts}
                  change={(v) => {
                    if (!v) {
                      if (pivot && id !== "series") {
                        const other = pivot[id === "row" ? "column" : "row"];
                        change({
                          ...p,
                          display: "chart",
                          pivot: undefined,
                          group:
                            daily || other === "day" || other === "measure"
                              ? "source"
                              : other,
                        });
                        return;
                      }
                      if (pivot && id === "series")
                        change({
                          ...p,
                          pivot: {
                            ...pivot,
                            series: undefined,
                            metrics:
                              pivot.series === "measure"
                                ? undefined
                                : pivot.metrics,
                          },
                        });
                      return;
                    }
                    if (v === "slot_total" || v === "all") {
                      change(changeGroup(p, v));
                      return;
                    }
                    const f: Field = v.startsWith("axis/")
                      ? { kind: "dimension", key: v.slice(5) as Dimension }
                      : { kind: "measure", key: v };
                    const next = candidates(f).find((c) => c.id === id)?.panel;
                    if (next) change(next);
                  }}
                />
                {axis === "measure" &&
                  pivot &&
                  pivot.metrics?.map((m) => (
                    <button
                      type="button"
                      key={m}
                      aria-label={m + " を外す"}
                      onClick={() => {
                        const rest = pivot.metrics?.filter((k) => k !== m);
                        change({
                          ...p,
                          pivot: {
                            ...pivot,
                            metrics: rest?.length ? rest : undefined,
                          },
                        });
                      }}
                    >
                      {metricName(m)} ×
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
        <div className="preview-head">
          {hovered ? (
            <h4>
              {fieldName} → {hovered.label}
            </h4>
          ) : (
            <h4>プレビュー</h4>
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
        <PanelView
          panel={{ ...preview, title: preview.title.trim() || "プレビュー" }}
          end={end}
        />
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
