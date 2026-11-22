import { useState } from "react";
import {
  type Axis,
  axes,
  blankPanel,
  changeGroup,
  cpuPercent,
  type Dimension,
  type Distinct,
  defaultTotalSlots,
  isAttribute,
  isTimeField,
  measures,
  metricName,
  type Overview,
  type Panel,
  type Pivot,
  pivotFields,
  type ShelfAxis,
  shelfFields,
  shelfName,
  slotTotalChoice,
  type TimeField,
  timeBuckets,
} from "../../../shared/console";
import { useQuery } from "../api";
import { PanelView, Select } from "./Panels";
import { useDropPreview } from "./useDropPreview";

type Props = {
  back: () => void;
  actions: React.ReactNode;
  p: Panel;
  set: (p: Panel) => void;
  meta: Overview;
  end: string;
};
const dimensions = Object.entries(axes) as [Axis, string][];
export function PanelBuilder({ p, set, meta, end, actions, back }: Props) {
  const [settingsOpen, showSettings] = useState(false);
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
    ...[p.group, ...(p.pivot ? pivotFields(p.pivot) : [])].filter(
      (k) => k && isAttribute(k),
    ),
  ]);
  const fields: [Dimension | TimeField, string][] = [
    ...(daily ? [] : (Object.entries(timeBuckets) as [TimeField, string][])),
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
      cpuPercent,
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
        metric === cpuPercent && p.group === "slot_total"
          ? "source"
          : p.group === "slot_total" && measure !== "metric"
            ? "source"
            : p.group,
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
  function assign(
    base: Panel,
    shelf: Shelf,
    field: ShelfAxis,
    position?: number,
  ): Panel {
    const pair: Pivot = {
      ...(base.pivot ??
        (base.distinct?.dataset === "daily"
          ? { row: "day", column: "source" }
          : { row: [], column: [], mark: "auto" as const })),
    };
    if (isTimeField(field)) pair.mark ??= "auto";
    const before = shelfFields(pair[shelf]);
    for (const role of shelves)
      pair[role] = shelfFields(pair[role]).filter(
        (k) =>
          k !== field &&
          !(role === shelf && isTimeField(field) && isTimeField(k)),
      );
    const next = shelfFields(pair[shelf]);
    const index =
      position ??
      (before.includes(field) ? before.indexOf(field) : next.length);
    next.splice(index, 0, field);
    pair[shelf] = next;
    if (!shelfFields(pair.series).length) delete pair.series;
    if (
      isTimeField(field) &&
      shelf !== "series" &&
      !pivotFields(pair).includes("measure")
    ) {
      const opposite = shelf === "row" ? "column" : "row";
      if (!shelfFields(pair[opposite]).length) pair[opposite] = ["measure"];
    }
    if (!pivotFields(pair).includes("measure")) delete pair.metrics;
    return {
      ...base,
      group: base.group === "slot_total" ? "source" : base.group,
      display: "pivot",
      pivot: pair,
    };
  }
  function without(id: Shelf, field: ShelfAxis) {
    if (!pivot) return;
    if (field === "measure" && pivot.metrics?.length) {
      const [metric, ...rest] = pivot.metrics;
      change({
        ...p,
        metric,
        unit: !rest.length && metric === "memory.current" ? "MiB" : undefined,
        pivot: { ...pivot, metrics: rest.length ? rest : undefined },
      });
      return;
    }
    const pair = {
      ...pivot,
      [id]: shelfFields(pivot[id]).filter((k) => k !== field),
    };
    if (field === "measure") delete pair.metrics;
    change({ ...p, pivot: pair });
  }
  function placeMeasure(which: Shelf, key: string): Panel {
    const next = picked(key);
    if (
      key.startsWith("metric/") &&
      p.measure === "metric" &&
      pivot &&
      shelfFields(pivot[which]).includes("measure")
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
    | { kind: "dimension"; key: Dimension | TimeField }
    | { kind: "placed"; key: ShelfAxis };
  function candidates(field: Field, position?: number) {
    const options: {
      id: string;
      label: string;
      panel?: Panel;
      filter?: Axis;
    }[] = [];
    if (field.kind === "placed") {
      for (const id of shelves)
        if (!daily || id !== "series")
          options.push({
            id,
            label: { row: "行", column: "列", series: "系列" }[id],
            panel: assign(
              p,
              id,
              field.key,
              position ?? shelfFields(p.pivot?.[id]).length,
            ),
          });
      return options;
    }
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
      options.push({
        id: "series",
        label: "系列",
        panel: daily ? { ...p, group: "source" } : assign(p, "series", key),
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
    const [role, pos] = id.split("/");
    const option = candidates(
      field,
      pos === undefined ? undefined : Number(pos),
    ).find((o) => o.id === role);
    if (option?.panel) change(option.panel);
    if (option?.filter) filterBy(option.filter);
  });
  const item = drag.preview?.item;
  const [targetRole, targetPosition] = (drag.preview?.target ?? "").split("/");
  const targets = item
    ? candidates(
        item,
        targetPosition === undefined ? undefined : Number(targetPosition),
      )
    : [];
  const hovered = targets.find((o) => o.id === targetRole);
  const preview = hovered?.panel ?? p;
  const fieldName =
    item && item.kind !== "measure"
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
    <>
      <div className="worksheet-heading">
        <h2>ワークシート</h2>
        <label className="sheet-title">
          パネル名
          <input
            required
            maxLength={512}
            value={p.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <button type="button" onClick={back}>
          配置に戻る
        </button>
      </div>
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
          <div className="catalog-list">
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
                  onPointerDown={(e) =>
                    drag.start(e, { kind: "measure", key: k })
                  }
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
                        : k === "day" || isTimeField(k)
                          ? change(assign(p, "row", k))
                          : update("group", k)
                  }
                >
                  {v}
                </button>
              ))}
          </div>
        </div>
        <div className="builder-main">
          <div className="worksheet-shelves">
            {shelves.map((id) => {
              const assigned = pivot ? shelfFields(pivot[id]) : [];
              const axis = assigned.at(-1);
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
                if (f.kind === "placed") return true;
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
                    ? "フィールドを追加"
                    : id === "row"
                      ? "値"
                      : id === "column"
                        ? "時間 / カテゴリ"
                        : "未設定",
                ],
                ...(id === "series" && !pivot && !daily
                  ? [
                      ["all", "全体"] as [string, string],
                      ...(p.measure === "metric" && p.metric !== cpuPercent
                        ? [slotTotalChoice]
                        : []),
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
                    value={pivot ? "" : value}
                    choices={opts}
                    change={(v) => {
                      if (!v) return;
                      if (v === "slot_total" || v === "all") {
                        change(changeGroup(p, v));
                        return;
                      }
                      const f: Field = v.startsWith("axis/")
                        ? {
                            kind: "dimension",
                            key: v.slice(5) as Dimension | TimeField,
                          }
                        : { kind: "measure", key: v };
                      const next = candidates(f).find(
                        (c) => c.id === id,
                      )?.panel;
                      if (next) change(next);
                    }}
                  />
                  {pivot && (
                    <div className="shelf-chips">
                      {assigned.map((field, i) => (
                        <span
                          className="shelf-chip"
                          key={field}
                          data-drop={
                            item?.kind === "placed" ? id + "/" + i : undefined
                          }
                        >
                          <button
                            type="button"
                            className="drag-source"
                            title="ドラッグまたは Alt＋左右矢印で移動"
                            onPointerDown={(e) =>
                              drag.start(e, { kind: "placed", key: field })
                            }
                            onKeyDown={(e) => {
                              if (
                                !e.altKey ||
                                !["ArrowLeft", "ArrowRight"].includes(e.key)
                              )
                                return;
                              e.preventDefault();
                              change(
                                assign(
                                  p,
                                  id,
                                  field,
                                  Math.max(
                                    0,
                                    i + (e.key === "ArrowLeft" ? -1 : 1),
                                  ),
                                ),
                              );
                            }}
                          >
                            {field === "measure"
                              ? choices.find(([k]) => k === selected)?.[1]
                              : shelfName(field)}
                          </button>
                          {!daily && (
                            <button
                              type="button"
                              aria-label={
                                shelfName(field) +
                                " を" +
                                { row: "行", column: "列", series: "系列" }[
                                  id
                                ] +
                                "から外す"
                              }
                              onClick={() => without(id, field)}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {assigned.includes("measure") &&
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
              className="settings-toggle"
              aria-expanded={settingsOpen}
              aria-controls="worksheet-options"
              onClick={() => showSettings(!settingsOpen)}
            >
              設定
            </button>
            {pivot && (
              <button
                type="button"
                onClick={() =>
                  change({
                    ...p,
                    pivot: { ...pivot, row: pivot.column, column: pivot.row },
                  })
                }
              >
                行と列を入れ替え
              </button>
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
        </div>
        <section
          className="worksheet-options"
          id="worksheet-options"
          aria-label="表示と絞り込み"
          data-open={settingsOpen || undefined}
        >
          <div className="options-heading">
            <h4>表示と絞り込み</h4>
            <button
              type="button"
              className="settings-toggle"
              onClick={() => showSettings(false)}
            >
              閉じる
            </button>
          </div>
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
                      ["pivot", "ワークシート"],
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
                        : { row: "source", column: "slot", mark: "auto" }
                      : undefined,
                })
              }
            />
            {pivot && !daily && (
              <Select
                label="マーク"
                value={pivot.mark ?? "table"}
                choices={[
                  ["auto", "自動"],
                  ["line", "折れ線"],
                  ["table", "ピボット表"],
                ]}
                change={(v) =>
                  change({
                    ...p,
                    pivot: { ...pivot, mark: v as Pivot["mark"] },
                  })
                }
              />
            )}
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
          {actions}
        </section>
      </div>
    </>
  );
}
