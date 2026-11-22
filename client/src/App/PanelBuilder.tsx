import { useId, useState } from "react";
import {
  type Axis,
  axes,
  blankPanel,
  changeGroup,
  cpuPercent,
  type Dimension,
  type Distinct,
  type FieldCondition,
  type FilterField,
  type Identifier,
  isAttribute,
  isTimeField,
  measures,
  metricName,
  type Overview,
  type Panel,
  type Pivot,
  pivotFields,
  type ShelfAxis,
  type StyleChannel,
  shelfFields,
  shelfName,
  slotTotalChoice,
  styleChannels,
  type TimeField,
  timeBuckets,
  usesLogRecords,
} from "../../../shared/console";
import { useQuery } from "../api";
import { FilterShelf } from "./FilterShelf";
import { PanelView, Select } from "./Panels";
import { styleNames } from "./SeriesStyle";
import { ShelfPicker } from "./ShelfPicker";
import { useDropPreview } from "./useDropPreview";

type Props = {
  back: () => void;
  actions: React.ReactNode;
  p: Panel;
  set: (p: Panel) => void;
  meta: Overview;
  end: string;
  minutes: number;
  timeControl: React.ReactNode;
};
const dimensions = Object.entries(axes) as [Axis, string][];
function styleTargets(format: string, pivot?: Pivot) {
  const row = shelfFields(pivot?.row),
    col = shelfFields(pivot?.column);
  const category = row.includes("measure")
    ? col
    : col.includes("measure")
      ? row
      : [];
  const line =
    format === "line" ||
    format === "mixed" ||
    (format === "auto" && category.length === 1 && isTimeField(category[0]));
  return (Object.entries(styleChannels) as [StyleChannel, string][]).filter(
    ([ch]) =>
      line ||
      (ch === "color" && ["auto", "bar", "stacked_area"].includes(format)),
  );
}
export function PanelBuilder({
  p,
  set,
  meta,
  end,
  minutes,
  timeControl,
  actions,
  back,
}: Props) {
  const [settingsOpen, showSettings] = useState(false);
  const [picker, openPicker] = useState<
    Shelf | StyleChannel | "measure" | "group"
  >();
  const [search, find] = useState("");
  const [undo, remember] = useState<Panel[]>([]);
  function change(next: Panel) {
    if (
      !usesLogRecords(next) &&
      next.conditions?.some((c) => c.field === "log")
    )
      next = {
        ...next,
        conditions: next.conditions.filter((c) => c.field !== "log"),
      };
    if (next.pivot?.encoding) {
      const pivot = next.pivot;
      const row = shelfFields(pivot.row),
        col = shelfFields(pivot.column);
      const active = new Set([
        ...shelfFields(pivot.series),
        ...(row.includes("measure") ? row : col.includes("measure") ? col : []),
      ]);
      const available = new Set(
        styleTargets(
          pivot.metricOptions?.some((o) => o.mark && o.mark !== pivot.mark)
            ? "mixed"
            : (pivot.mark ?? "table"),
          pivot,
        ).map(([channel]) => channel),
      );
      const encoding = Object.fromEntries(
        Object.entries(pivot.encoding ?? {}).filter(
          ([channel, field]) =>
            active.has(field) && available.has(channel as StyleChannel),
        ),
      );
      const original = Object.values(pivot.encoding ?? {});
      const series = shelfFields(pivot.series).filter(
        (f) => !original.includes(f) || Object.values(encoding).includes(f),
      );
      const rules = pivot.styleRules?.filter(
        (r) =>
          encoding[r.channel] &&
          encoding[r.channel] === p.pivot?.encoding?.[r.channel],
      );
      next = {
        ...next,
        pivot: {
          ...pivot,
          series,
          encoding: Object.keys(encoding).length ? encoding : undefined,
          styleRules: rules?.length ? rules : undefined,
        },
      };
    }
    if (next.pivot?.metricOptions) {
      const pivot = { ...next.pivot };
      const names =
        next.measure === "metric" && pivotFields(pivot).includes("measure")
          ? [next.metric, ...(pivot.metrics ?? [])]
          : [];
      const opts =
        pivot.metricOptions?.filter((o) => names.includes(o.metric)) ?? [];
      if (names.length === 1 && opts[0]) {
        pivot.mark = opts[0].mark ?? pivot.mark;
        next = {
          ...next,
          aggregation: opts[0].aggregation ?? next.aggregation,
        };
      }
      pivot.metricOptions = names.length > 1 && opts.length ? opts : undefined;
      next = { ...next, pivot };
    }
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
    minutes,
  });
  const keys = new Set([
    ...(observed.data ?? []).map((k) => "attr:" + k),
    ...[
      ...(p.conditions ?? []).map((c) => c.field),
      p.group,
      ...(p.pivot ? pivotFields(p.pivot) : []),
    ].filter((k) => k && isAttribute(k)),
  ]);
  const fields: [Dimension | TimeField, string][] = [
    ...(daily ? [] : [["time:60", "時刻"] as [TimeField, string]]),
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
      conditions: next.conditions?.filter(
        (c) => c.field === "source" || c.field === "day",
      ),
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
      pivot: p.pivot
        ? { ...p.pivot, metrics: undefined, metricOptions: undefined }
        : undefined,
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
  type Shelf = "row" | "column";
  const shelves: Shelf[] = ["row", "column"];
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
          : {
              row: shelf === "row" ? [] : ["measure"],
              column: shelf === "column" ? [] : ["time:60"],
              mark: "line" as const,
              series:
                base.group !== "all" && base.group !== "slot_total"
                  ? [base.group]
                  : [],
            })),
    };

    const before = shelfFields(pair[shelf]);
    for (const role of [...shelves, "series"] as const)
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
    if (isTimeField(field) && !pivotFields(pair).includes("measure")) {
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
  function configurePlotAxes(next: Pivot) {
    const row = shelfFields(next.row),
      column = shelfFields(next.column);
    if (!row.includes("measure") && !column.includes("measure")) {
      next.series = shelfFields(next.series).filter((k) => k !== "measure");
      if (row.length && !column.length) next.column = "measure";
      else next.row = ["measure", ...row];
    }
    for (const side of ["row", "column"] as const) {
      if (!shelfFields(next[side]).length) {
        const other = side === "row" ? "column" : "row";
        const time = shelfFields(next[other]).find(isTimeField) ?? "time:60";
        next[other] = shelfFields(next[other]).filter((k) => k !== time);
        next.series = shelfFields(next.series).filter((k) => k !== time);
        next[side] = time;
      }
    }
  }
  function setFormat(format: string) {
    if (daily) {
      change({
        ...p,
        display: format === "line" ? "chart" : "pivot",
        group: "source",
        pivot: format === "line" ? undefined : { row: "day", column: "source" },
      });
      return;
    }
    if (format === "summary" || format === "value") {
      change({
        ...p,
        display: format === "summary" ? "table" : "value",
        pivot: undefined,
      });
      return;
    }
    if (!pivot && format === "line") {
      change({ ...p, display: "chart", pivot: undefined });
      return;
    }
    const next: Pivot = pivot
      ? { ...pivot }
      : format === "table"
        ? { row: "source", column: "slot" }
        : {
            row: "measure",
            column: "time:60",
            series:
              p.group === "slot_total"
                ? ["source", "workload", "slot"]
                : p.group === "all"
                  ? []
                  : [p.group],
          };
    if (format !== "table") configurePlotAxes(next);
    change({
      ...p,
      display: "pivot",
      group: p.group === "slot_total" ? "source" : p.group,
      totalSlots: undefined,
      pivot: {
        ...next,
        mark: format as Pivot["mark"],
        metricOptions: next.metricOptions?.map(({ metric, aggregation }) => ({
          metric,
          aggregation,
        })),
      },
    });
  }
  const multiple = pivot && !!pivot.metrics?.length;
  const worksheetId = useId();
  const aggregationNames: Record<Panel["aggregation"], string> = {
    avg: "平均",
    max: "最大",
    min: "最小",
    sum: "合計",
  };
  function aggregation(metric: string) {
    return (
      (pivot &&
        pivot.metricOptions?.find((o) => o.metric === metric)?.aggregation) ||
      p.aggregation
    );
  }
  function metricTrigger(metric: string) {
    const id = worksheetId + "-aggregation-" + encodeURIComponent(metric);
    return {
      popoverTarget: id,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const menu = document.getElementById(id);
        menu?.style.setProperty("--trigger-left", rect.left + "px");
        menu?.style.setProperty("--trigger-bottom", rect.bottom + "px");
      },
    };
  }
  function metricMenu(metric: string) {
    const id = worksheetId + "-aggregation-" + encodeURIComponent(metric);
    return (
      <fieldset
        id={id}
        popover="auto"
        className="metric-menu"
        aria-label={metricName(metric) + "の集計"}
      >
        <span>集計</span>
        {(Object.keys(aggregationNames) as Panel["aggregation"][])
          .filter((k) => p.group !== "slot_total" || k !== "sum")
          .map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={aggregation(metric) === value}
              popoverTarget={id}
              popoverTargetAction="hide"
              onClick={() => {
                if (multiple && pivot) {
                  const options = pivot.metricOptions ?? [];
                  change({
                    ...p,
                    pivot: {
                      ...pivot,
                      metricOptions: [
                        ...options.filter((o) => o.metric !== metric),
                        {
                          ...options.find((o) => o.metric === metric),
                          metric,
                          aggregation: value,
                        },
                      ],
                    },
                  });
                } else change({ ...p, aggregation: value });
              }}
            >
              {aggregationNames[value]}
            </button>
          ))}
      </fieldset>
    );
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
  const [openFilter, openConditions] = useState<FilterField>();
  const identifiers: Identifier[] = [
    "source",
    "slot",
    "revision",
    "instance",
    "workload",
  ];
  const logs = usesLogRecords(p);
  const legacyLog =
    logs && !!p.text && !p.conditions?.some((c) => c.field === "log");
  const conditions: FieldCondition[] = [...(p.conditions ?? [])];
  if (legacyLog) conditions.push({ field: "log", contains: p.text });
  for (const k of identifiers)
    if (p[k] && !conditions.some((c) => c.field === k))
      conditions.push({ field: k, values: [p[k]] });
  function writeFilter(field: FilterField, next?: FieldCondition) {
    const values = [...(p.conditions ?? [])];
    const index = values.findIndex((c) => c.field === field);
    if (index >= 0) values.splice(index, 1, ...(next ? [next] : []));
    else if (next) values.push(next);
    const panel = { ...p, conditions: values.length ? values : undefined };
    for (const k of identifiers) if (k === field) panel[k] = "";
    if (field === "log" && legacyLog) panel.text = "";
    change(panel);
  }
  function addFilter(field: FilterField) {
    if (isTimeField(field))
      field = conditions.find((c) => isTimeField(c.field))?.field ?? field;
    if (!conditions.some((c) => c.field === field))
      writeFilter(field, { field });
    openConditions(field);
  }
  const filterFields: [FilterField, string][] = fields.filter(
    ([k]) => p.group !== "slot_total" || (k !== "slot" && k !== "instance"),
  );
  if (logs) filterFields.push(["log", "ログ"]);
  const stylePivot: Pivot | undefined =
    (pivot && { ...pivot }) ||
    (!daily && p.display === "chart" && p.group !== "slot_total"
      ? {
          row: "measure",
          column: "time:60",
          series: p.group === "all" ? [] : [p.group],
          mark: "line",
        }
      : undefined);
  if (
    stylePivot?.mark &&
    stylePivot.mark !== "table" &&
    !pivotFields(stylePivot).includes("measure")
  )
    configurePlotAxes(stylePivot);
  const valueSide =
    stylePivot &&
    (shelfFields(stylePivot.row).includes("measure")
      ? "row"
      : shelfFields(stylePivot.column).includes("measure")
        ? "column"
        : undefined);
  const styleFields =
    stylePivot && valueSide
      ? Array.from(
          new Set([
            ...shelfFields(stylePivot.series),
            ...shelfFields(stylePivot[valueSide]),
            ...fields
              .map(([f]) => f)
              .filter(
                (f) =>
                  !isTimeField(f) &&
                  !shelfFields(
                    stylePivot[valueSide === "row" ? "column" : "row"],
                  ).includes(f),
              ),
          ]),
        )
      : [];
  const legacyMarks = new Set(
    pivot && multiple
      ? [p.metric, ...(pivot.metrics ?? [])].map(
          (m) =>
            pivot.metricOptions?.find((o) => o.metric === m)?.mark ??
            pivot.mark ??
            "table",
        )
      : [],
  );
  const format =
    legacyMarks.size > 1
      ? "mixed"
      : legacyMarks.size
        ? [...legacyMarks][0]
        : pivot
          ? (pivot.mark ?? "table")
          : p.display === "chart"
            ? "line"
            : p.display === "table"
              ? "summary"
              : p.display;
  const grouped = format === "summary" || format === "value";
  const axisLabels =
    format === "table"
      ? { row: "行", column: "列" }
      : { row: "縦軸", column: "横軸" };
  const visibleAxes: Shelf[] =
    grouped || (daily && !pivot)
      ? []
      : format === "table"
        ? shelves
        : ["column", "row"];
  const valueSlot =
    grouped ||
    daily ||
    (format === "table" && pivot && !pivotFields(pivot).includes("measure"));
  const groupChoices: [string, string][] = [
    ["all", "全体"],
    ...fields.filter(([k]) => k !== "day" && !isTimeField(k)),
    ...(p.group === "slot_total" ? [slotTotalChoice] : []),
  ];
  const channels = styleTargets(format, stylePivot);
  const encoding = { ...stylePivot?.encoding };
  const unassigned = shelfFields(stylePivot?.series).filter(
    (f) => !Object.values(encoding).includes(f),
  );
  for (const [ch] of channels) {
    if (!encoding[ch] && unassigned.length) encoding[ch] = unassigned.shift();
  }
  function withStyle(channel: StyleChannel, field?: ShelfAxis): Panel {
    const base =
      channel === "color" && p.fixedStyle?.color !== undefined
        ? { ...p, fixedStyle: { ...p.fixedStyle, color: undefined } }
        : p;
    if (!stylePivot || (!field && !encoding[channel])) return base;
    const mapped = { ...encoding, [channel]: field };
    const axes = [
      ...shelfFields(stylePivot.row),
      ...shelfFields(stylePivot.column),
    ];
    const series = [
      ...new Set([
        ...unassigned,
        ...Object.values(mapped).filter(
          (f): f is ShelfAxis => !!f && !axes.includes(f),
        ),
      ]),
    ];
    return {
      ...base,
      display: "pivot",
      pivot: { ...stylePivot, series, encoding: mapped },
    };
  }
  type Field =
    | { kind: "log"; key: "log" }
    | { kind: "measure"; key: string }
    | { kind: "dimension"; key: Dimension | TimeField }
    | { kind: "placed"; key: ShelfAxis };
  function candidates(field: Field, position?: number) {
    const options: {
      id: string;
      label: string;
      panel?: Panel;
      filter?: FilterField;
    }[] = [];
    if (field.kind === "log")
      return [
        ...options,
        { id: "filter", label: "フィルター", filter: "log" as const },
      ];
    if (
      (field.kind === "dimension" || field.kind === "placed") &&
      styleFields.includes(field.key)
    ) {
      for (const [channel] of channels)
        options.push({
          id: "style-" + channel,
          label: styleChannels[channel],
          panel: withStyle(channel, field.key),
        });
    }
    if (field.kind === "placed") {
      for (const id of visibleAxes)
        options.push({
          id,
          label: axisLabels[id],
          panel: assign(
            p,
            id,
            field.key,
            position ?? shelfFields(p.pivot?.[id]).length,
          ),
        });
      if (
        field.key !== "measure" &&
        filterFields.some(([k]) => k === field.key)
      )
        options.push({ id: "filter", label: "フィルター", filter: field.key });
      return options;
    }
    if (field.kind === "measure") {
      const base = picked(field.key);
      if (valueSlot) options.push({ id: "measure", label: "値", panel: base });
      if (base.distinct?.dataset !== "daily")
        for (const id of visibleAxes)
          options.push({
            id,
            label: axisLabels[id],
            panel: placeMeasure(id, field.key),
          });
      return options;
    }
    const key =
      isTimeField(field.key) && pivot
        ? (pivotFields(pivot).find(isTimeField) ?? field.key)
        : field.key;
    for (const id of visibleAxes)
      options.push({ id, label: axisLabels[id], panel: assign(p, id, key) });
    if (grouped && key !== "day" && !isTimeField(key))
      options.push({ id: "group", label: "分類", panel: changeGroup(p, key) });
    if (isTimeField(key) || filterFields.some(([k]) => k === key))
      options.push({ id: "filter", label: "フィルター", filter: key });
    return options;
  }
  const drag = useDropPreview<Field>((field, id) => {
    const [role, pos] = id.split("/");
    const option = candidates(
      field,
      pos === undefined ? undefined : Number(pos),
    ).find((o) => o.id === role);
    if (option?.panel) change(option.panel);
    if (option?.filter) addFilter(option.filter);
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
  const candidate = hovered?.panel;
  const preview =
    candidate &&
    !usesLogRecords(candidate) &&
    candidate.conditions?.some((c) => c.field === "log")
      ? {
          ...candidate,
          conditions: candidate.conditions.filter((c) => c.field !== "log"),
        }
      : (candidate ?? p);
  const fieldName =
    item && item.kind !== "measure"
      ? isTimeField(item.key)
        ? "時刻"
        : shelfName(item.key)
      : choices.find(([k]) => k === item?.key)?.[1];

  return (
    <>
      <div className="worksheet-heading">
        <h2>パネル編集</h2>
        <label className="sheet-title">
          パネル名
          <input
            required
            maxLength={512}
            value={p.title}
            onChange={(e) => update("title", e.target.value)}
          />
        </label>
        <div className="worksheet-heading-actions">
          {timeControl}
          <button
            className="primary"
            type="button"
            title="変更を下書きに反映して配置に戻る"
            onClick={back}
          >
            配置に戻る
          </button>
        </div>
      </div>
      <div className="builder" {...drag.bind}>
        {item && (
          <span className="drag-ghost" aria-hidden="true">
            {fieldName}
          </span>
        )}
        <div className="worksheet-format">
          <Select
            label="表示形式"
            value={format}
            choices={
              daily
                ? [
                    ["table", "ピボット表"],
                    ["line", "折れ線"],
                  ]
                : [
                    ...(format === "mixed"
                      ? [["mixed", "保存済みの複合表示"] as [string, string]]
                      : []),
                    ["auto", "自動"],
                    ["line", "折れ線"],
                    ["bar", "棒"],
                    ["stacked_area", "積み上げ面"],
                    ["table", "ピボット表"],
                    ...(multiple
                      ? []
                      : ([
                          ["summary", "集計表"],
                          ["value", "数値"],
                        ] as [string, string][])),
                  ]
            }
            change={setFormat}
          />
        </div>
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
            {"ログ log".includes(search.toLowerCase()) && (
              <button
                type="button"
                className="drag-source"
                disabled={!logs}
                title={
                  logs
                    ? "ログ本文をフィルター"
                    : "ログ件数・ログ属性のユニーク数で使用できます"
                }
                onPointerDown={(e) =>
                  drag.start(e, { kind: "log", key: "log" })
                }
                onClick={() => addFilter("log")}
              >
                ログ
              </button>
            )}
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
                  onClick={() => {
                    if (grouped) {
                      if (k !== "day" && !isTimeField(k))
                        change(changeGroup(p, k));
                    } else if (visibleAxes.length)
                      change(
                        assign(p, format === "table" ? "row" : "column", k),
                      );
                  }}
                >
                  {v}
                </button>
              ))}
          </div>
        </div>
        <div className="builder-main">
          <FilterShelf
            panel={{
              ...p,
              minutes,
              ...Object.fromEntries(
                identifiers.filter((k) => k === openFilter).map((k) => [k, ""]),
              ),
            }}
            end={end}
            items={conditions}
            fields={filterFields}
            open={openFilter}
            setOpen={openConditions}
            add={addFilter}
            change={(c) => writeFilter(c.field, c)}
            remove={(k) => {
              writeFilter(k);
              if (openFilter === k) openConditions(undefined);
            }}
            ready={targets.some((t) => t.id === "filter")}
            hover={targetRole === "filter"}
          />
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
            onStyleRules={(rules) => {
              if (pivot)
                change({ ...p, pivot: { ...pivot, styleRules: rules } });
            }}
            panel={{
              ...preview,
              minutes,
              title: preview.title.trim() || "プレビュー",
            }}
            end={end}
          />
        </div>
        <section
          className="worksheet-options"
          id="worksheet-options"
          aria-label="パネル設定"
          data-open={settingsOpen || undefined}
        >
          <div className="assignment-pane">
            <fieldset
              className="worksheet-shelves"
              aria-label="フィールドの割り当て"
            >
              {visibleAxes.map((id) => {
                const assigned = pivot ? shelfFields(pivot[id]) : [];
                const label = axisLabels[id];
                const implicit = pivot
                  ? ""
                  : id === "column"
                    ? "時刻"
                    : choices.find(([key]) => key === selected)?.[1];
                const opts: [string, string][] = [
                  ...fields.map(([k, v]): [string, string] => ["axis/" + k, v]),
                  ...choices.filter(
                    ([key]) => key !== "distinct" || !meta.dailyFields.length,
                  ),
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
                    <button
                      type="button"
                      className="shelf-target"
                      aria-label={label + "にフィールドを追加"}
                      title="フィールドをドロップ、またはクリックして選択"
                      onClick={() => openPicker(id)}
                    >
                      <strong>{label}</strong>
                      {!assigned.length &&
                        !(!pivot && id === "row" && p.measure === "metric") && (
                          <span>{implicit || "ここにドロップ"}</span>
                        )}
                    </button>
                    {!pivot && id === "row" && p.measure === "metric" && (
                      <button type="button" {...metricTrigger(p.metric)}>
                        {metricName(p.metric)} ·{" "}
                        {aggregationNames[aggregation(p.metric)]}
                      </button>
                    )}
                    {((!pivot && id === "row") ||
                      assigned.includes("measure")) &&
                      p.measure === "metric" &&
                      metricMenu(p.metric)}
                    {picker === id && (
                      <ShelfPicker
                        label={label}
                        choices={opts}
                        close={() => openPicker(undefined)}
                        select={(v) => {
                          if (!v) return;
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
                    )}
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
                              title={
                                field === "measure" && p.measure === "metric"
                                  ? "クリックして集計を変更"
                                  : "ドラッグまたは Alt＋左右矢印で移動"
                              }
                              {...(field === "measure" && p.measure === "metric"
                                ? metricTrigger(p.metric)
                                : {})}
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
                                : isTimeField(field)
                                  ? "時刻"
                                  : shelfName(field)}
                            </button>
                            {field === "measure" && p.measure === "metric" && (
                              <small>
                                {aggregationNames[aggregation(p.metric)]}
                              </small>
                            )}
                            {isTimeField(field) && (
                              <select
                                aria-label={label + "の時刻の粒度"}
                                value={field}
                                onChange={(e) => {
                                  const grain = e.target.value as TimeField;
                                  const encoding = { ...pivot.encoding };
                                  for (const channel of Object.keys(
                                    encoding,
                                  ) as StyleChannel[])
                                    if (encoding[channel] === field)
                                      encoding[channel] = grain;
                                  change({
                                    ...p,
                                    pivot: {
                                      ...pivot,
                                      encoding,
                                      [id]: assigned.map((k) =>
                                        k === field ? grain : k,
                                      ),
                                    },
                                  });
                                }}
                              >
                                {(
                                  Object.entries(timeBuckets) as [
                                    TimeField,
                                    string,
                                  ][]
                                ).map(([key, name]) => (
                                  <option
                                    key={key}
                                    value={key}
                                    disabled={
                                      key !== field &&
                                      pivotFields(pivot).includes(key)
                                    }
                                  >
                                    {name.slice(3, -1)}
                                  </option>
                                ))}
                              </select>
                            )}
                            {!daily && (
                              <button
                                type="button"
                                aria-label={
                                  shelfName(field) + " を" + label + "から外す"
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
                        <div className="shelf-chip" key={m}>
                          <button type="button" {...metricTrigger(m)}>
                            {metricName(m)} · {aggregationNames[aggregation(m)]}
                          </button>
                          {metricMenu(m)}
                          <button
                            type="button"
                            key={m}
                            aria-label={m + " を外す"}
                            onClick={() => {
                              const rest = pivot.metrics?.filter(
                                (k) => k !== m,
                              );
                              change({
                                ...p,
                                pivot: {
                                  ...pivot,
                                  metrics: rest?.length ? rest : undefined,
                                },
                              });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                );
              })}
              {valueSlot && (
                <div
                  data-drop="measure"
                  data-ready={
                    targets.some((t) => t.id === "measure") || undefined
                  }
                  data-preview={targetRole === "measure" || undefined}
                >
                  <button
                    type="button"
                    className="style-target"
                    onClick={() => openPicker("measure")}
                  >
                    <strong>値</strong>
                    <span>
                      {choices.find(([key]) => key === selected)?.[1]}
                    </span>
                  </button>
                  {p.measure === "metric" && (
                    <button type="button" {...metricTrigger(p.metric)}>
                      {aggregationNames[aggregation(p.metric)]}
                    </button>
                  )}
                  {p.measure === "metric" && metricMenu(p.metric)}
                  {picker === "measure" && (
                    <ShelfPicker
                      label="値"
                      choices={choices}
                      close={() => openPicker(undefined)}
                      select={pick}
                    />
                  )}
                </div>
              )}
              {grouped && (
                <div
                  data-drop="group"
                  data-ready={
                    targets.some((t) => t.id === "group") || undefined
                  }
                  data-preview={targetRole === "group" || undefined}
                >
                  <button
                    type="button"
                    className="style-target"
                    onClick={() => openPicker("group")}
                  >
                    <strong>分類</strong>
                    <span>
                      {groupChoices.find(([key]) => key === p.group)?.[1]}
                    </span>
                  </button>
                  {picker === "group" && (
                    <ShelfPicker
                      label="分類"
                      choices={groupChoices}
                      close={() => openPicker(undefined)}
                      select={(v) =>
                        change(changeGroup(p, v as Panel["group"]))
                      }
                    />
                  )}
                </div>
              )}
              {(p.display === "chart" || !!valueSide) &&
                channels.map(([channel, label]) => {
                  const target = "style-" + channel;
                  const field = encoding[channel];
                  const index = p.fixedStyle?.[channel];
                  const removable =
                    !!field || (channel === "color" && index !== undefined);
                  return (
                    <div
                      key={channel}
                      data-drop={styleFields.length ? target : undefined}
                      data-ready={
                        (item && targets.some((t) => t.id === target)) ||
                        undefined
                      }
                      data-preview={hovered?.id === target || undefined}
                    >
                      <div className="style-assignment">
                        <label htmlFor={worksheetId + target}>
                          <strong>{label}</strong>
                        </label>
                        <span
                          className="style-chip"
                          data-assigned={removable || undefined}
                        >
                          <button
                            type="button"
                            id={worksheetId + target}
                            disabled={
                              channel === "color" && !styleFields.length
                            }
                            aria-label={label + "に属性を割り当て"}
                            title={
                              field
                                ? shelfName(field)
                                : "属性をドロップ、またはクリックして選択"
                            }
                            onClick={() => openPicker(channel)}
                          >
                            {field
                              ? shelfName(field)
                              : index !== undefined
                                ? styleNames[channel][index]
                                : styleFields.length
                                  ? "属性をドロップ"
                                  : "既定"}
                          </button>
                          {removable && (
                            <button
                              type="button"
                              className="style-remove"
                              aria-label={label + "の割り当てを外す"}
                              onClick={() => change(withStyle(channel))}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </div>
                      {picker === channel && (
                        <ShelfPicker
                          label={label}
                          constants={
                            channel === "color"
                              ? undefined
                              : styleNames[channel].map(
                                  (name, i): [string, string] => [
                                    String(i),
                                    name,
                                  ],
                                )
                          }
                          setConstant={(v) =>
                            change({
                              ...(field ? withStyle(channel) : p),
                              fixedStyle: {
                                ...p.fixedStyle,
                                [channel]: Number(v),
                              },
                            })
                          }
                          choices={styleFields.map((f) => [f, shelfName(f)])}
                          close={() => openPicker(undefined)}
                          select={(v) =>
                            change(withStyle(channel, v as ShelfAxis))
                          }
                        />
                      )}
                    </div>
                  );
                })}
            </fieldset>
          </div>
          <div className="other-settings" data-open={settingsOpen || undefined}>
            <button
              type="button"
              className="settings-toggle"
              onClick={() => showSettings(false)}
            >
              閉じる
            </button>
            {pivot && unassigned.length > 0 && (
              <fieldset>
                <legend>保存済みの分類</legend>
                {unassigned.map((f) => (
                  <button
                    type="button"
                    key={f}
                    aria-label={shelfName(f) + "の分類を解除"}
                    onClick={() =>
                      change({
                        ...p,
                        pivot: {
                          ...pivot,
                          series: shelfFields(pivot.series).filter(
                            (k) => k !== f,
                          ),
                        },
                      })
                    }
                  >
                    {shelfName(f)} ×
                  </button>
                ))}
              </fieldset>
            )}
            <div className="fields">
              {!multiple && (
                <>
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
                </>
              )}
            </div>
            {p.text && !legacyLog && (
              <label>
                保存済みの本文・名前フィルター
                <input
                  value={p.text}
                  onChange={(e) => update("text", e.target.value)}
                />
              </label>
            )}
            {actions}
          </div>
        </section>
      </div>
    </>
  );
}
