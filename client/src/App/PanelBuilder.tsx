import { Fragment, useId, useState } from "react";
import {
  type Axis,
  aggNames,
  aggsFor,
  blankPanel,
  changeGroup,
  type DataKind,
  type Dimension,
  dataKinds,
  defaultAgg,
  type FieldCondition,
  type FilterField,
  fieldKey,
  fieldZone,
  identifiers,
  initialValue,
  isAttribute,
  isTemporalField,
  measurableFields,
  metricOf,
  type Overview,
  type Panel,
  type Pivot,
  perAggs,
  pivotFields,
  type ShelfAxis,
  type StyleChannel,
  shelfFields,
  shelfName,
  styleChannels,
  type TimeField,
  type TimeZone,
  timeBuckets,
  type Value,
  type ValueField,
  valueFieldName,
  valueKey,
  valueName,
} from "../../../shared/console";
import { useQuery } from "../api";
import { useDictionary, useFieldEditor } from "./dictionary";
import { FilterShelf } from "./FilterShelf";
import { compatibleUnits, nativeUnit } from "./fieldDisplay";
import { LegendStyleDialog } from "./LegendStyleDialog";
import { PanelView, Select } from "./Panels";
import { styleNames } from "./SeriesStyle";
import { ShelfPicker } from "./ShelfPicker";
import { useDropPreview } from "./useDropPreview";

function ShelfTarget({
  label,
  name,
  hint,
  disabled,
  open,
}: {
  label: string;
  name: string;
  hint?: string;
  disabled?: boolean;
  open: () => void;
}) {
  return (
    <button
      type="button"
      className="shelf-target"
      aria-label={name}
      disabled={disabled}
      title="フィールドをドロップ、またはクリックして選択"
      onClick={open}
    >
      <strong>{label}</strong>
      {hint && <span>{hint}</span>}
    </button>
  );
}

function UnitInput({
  source,
  value,
  write,
}: {
  source: string;
  value: string;
  write: (value: string) => void;
}) {
  const id = useId();
  const units = compatibleUnits(source);
  if (!units) return null;
  return (
    <label htmlFor={id}>
      表示単位
      <select id={id} value={value} onChange={(e) => write(e.target.value)}>
        <option value="">自動（{source}）</option>
        {Object.keys(units).map((unit) => (
          <option key={unit}>{unit}</option>
        ))}
      </select>
    </label>
  );
}

function intervalName(field: TimeField | "day") {
  return field === "day" || field === "time:86400"
    ? "1日"
    : timeBuckets[field].slice(3, -1);
}

type Props = {
  savePanel: () => void;
  cancelPanel: () => void;
  directSave: boolean;
  actions: React.ReactNode;
  p: Panel;
  set: (p: Panel) => void;
  meta: Overview;
  end: string;
  minutes: number;
  timeControl: React.ReactNode;
  /** Extra settings shown beside the shelves, such as a monitor's rule. */
  rule?: React.ReactNode;
  /** A monitor's threshold, drawn on the preview. */
  threshold?: number;
};
const dimensions: Axis[] = [...identifiers, "day"];
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
    format === "area" ||
    format === "mixed" ||
    (format === "auto" &&
      category.length === 1 &&
      isTemporalField(category[0]));
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
  savePanel,
  cancelPanel,
  directSave,
  rule,
  threshold,
}: Props) {
  const dict = useDictionary();
  const editField = useFieldEditor();
  const [settingsOpen, showSettings] = useState(false);
  const [picker, openPicker] = useState<
    Shelf | StyleChannel | "measure" | "group"
  >();
  const [search, find] = useState("");
  const [undo, remember] = useState<Panel[]>([]);
  function change(next: Panel) {
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
          next.values.some((v) => v.mark && v.mark !== pivot.mark)
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
          (encoding[r.channel] === p.pivot?.encoding?.[r.channel] ||
            !p.pivot?.styleRules?.includes(r)),
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
    next = normalized(next);
    remember((items) => [...items.slice(-25), p]);
    set(next);
  }
  const daily = p.data === "daily";
  const pivot = p.display === "pivot" && p.pivot;
  const metricsInUse = p.values.flatMap((v) => {
    const m = metricOf(v.of[0]);
    return m === undefined ? [] : [m];
  });
  const observed = useQuery<string[]>("worksheetAttributes", {
    data: daily ? "request" : p.data,
    conditions: p.conditions?.filter((c) => c.field === "source"),
    metric: metricsInUse[0],
    end,
    minutes,
  });
  const keys = new Set([
    ...(observed.data ?? []).map((k) => "attr:" + k),
    ...[
      ...(p.conditions ?? []).map((c) => c.field),
      p.group,
      ...(p.pivot ? pivotFields(p.pivot) : []),
      ...p.values.flatMap((v) => v.of),
    ].filter((k) => k && isAttribute(k)),
  ]);
  const fields: [Dimension | TimeField, string][] = [
    [daily ? "day" : "time:60", "時刻"],
    ...dimensions
      .filter((key) => key !== "day" && (!daily || key === "source"))
      .map((key): [Dimension, string] => [key, shelfName(key, dict)]),
  ];
  if (!daily)
    for (const key of keys)
      if (key && isAttribute(key)) fields.push([key, shelfName(key, dict)]);
  const countName = valueName(dict, p.data, { agg: "count", of: [] });
  /** Fields a value can measure: "" for the row count. */
  const measurable: [ValueField | "", string][] = [
    ...(aggsFor(p.data, []).length
      ? [["", countName] as [ValueField | "", string]]
      : []),
    ...Array.from(
      new Set([
        ...measurableFields(p.data, meta),
        ...p.values.flatMap((v) =>
          v.of.length === 1 &&
          (v.of[0].startsWith("metric:") || v.of[0].startsWith("set:"))
            ? [v.of[0]]
            : [],
        ),
      ]),
    ).map((f): [ValueField, string] => [f, valueFieldName(dict, p.data, f)]),
  ];
  const valueFor = (key: ValueField | ""): Value => {
    const of: ValueField[] = key ? [key] : [];
    return { agg: defaultAgg(dict, p.data, of), of };
  };
  const autoTitle = (q: Panel) =>
    q.values.map((v) => valueName(dict, q.data, v)).join("・");
  /** Keeps values, marks, units, groups and the title consistent. */
  function normalized(next: Panel): Panel {
    const onShelf =
      next.display === "pivot" &&
      !!next.pivot &&
      pivotFields(next.pivot).includes("measure");
    let values = next.values;
    if (!onShelf && values.length > 1) values = values.slice(0, 1);
    let pivot = next.pivot;
    if (values.length === 1 && values[0].mark && pivot)
      pivot = { ...pivot, mark: values[0].mark };
    if ((!onShelf || values.length === 1) && values.some((v) => v.mark))
      values = values.map(({ mark: _, ...v }) => v);
    const retitle =
      (next.values !== p.values || next.data !== p.data) &&
      (!p.title || p.title === autoTitle(p) || p.title === blankPanel.title);
    const result = { ...next, values, pivot };
    return retitle ? { ...result, title: autoTitle(result) } : result;
  }
  function dailyLayout(mark: Pivot["mark"], group: Panel["group"]): Pivot {
    if (!mark || mark === "table")
      return { row: "day", column: "source", mark: "table" };
    return {
      row: "measure",
      column: "day",
      series: group === "all" ? [] : ["source"],
      mark,
    };
  }
  function withData(panel: Panel, data: DataKind): Panel {
    const next: Panel = {
      ...panel,
      data,
      values: [initialValue(dict, data, meta)],
    };
    if (data !== "daily") return next;
    return {
      ...next,
      conditions: next.conditions?.filter(
        (c) => c.field === "source" || c.field === "day",
      ),
      display: panel.display === "chart" ? "pivot" : panel.display,
      pivot:
        panel.display === "chart" || panel.display === "pivot"
          ? dailyLayout(
              panel.display === "chart" ? "line" : panel.pivot?.mark,
              panel.group,
            )
          : undefined,
      group: panel.group === "all" ? "all" : "source",
    };
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
      ...(base.pivot ?? {
        row: shelf === "row" ? [] : ["measure"],
        column:
          shelf === "column" ? [] : [base.data === "daily" ? "day" : "time:60"],
        mark: "line" as const,
        series: base.group !== "all" ? [base.group] : [],
      }),
    };

    const before = shelfFields(pair[shelf]);
    for (const role of [...shelves, "series"] as const)
      pair[role] = shelfFields(pair[role]).filter(
        (k) =>
          k !== field &&
          !(role === shelf && isTemporalField(field) && isTemporalField(k)),
      );
    const next = shelfFields(pair[shelf]);
    const index =
      position ??
      (before.includes(field) ? before.indexOf(field) : next.length);
    next.splice(index, 0, field);
    pair[shelf] = next;
    if (!shelfFields(pair.series).length) delete pair.series;
    if (isTemporalField(field) && !pivotFields(pair).includes("measure")) {
      const opposite = shelf === "row" ? "column" : "row";
      if (!shelfFields(pair[opposite]).length) pair[opposite] = ["measure"];
    }
    return { ...base, display: "pivot", pivot: pair };
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
        const time =
          shelfFields(next[other]).find(isTemporalField) ??
          (daily ? "day" : "time:60");
        next[other] = shelfFields(next[other]).filter((k) => k !== time);
        next.series = shelfFields(next.series).filter((k) => k !== time);
        next[side] = time;
      }
    }
  }
  function setFormat(format: string) {
    if (format === "summary" || format === "value") {
      change({
        ...p,
        display: format === "summary" ? "table" : "value",
        pivot: undefined,
      });
      return;
    }
    if (!daily && !pivot && format === "line") {
      change({ ...p, display: "chart", pivot: undefined });
      return;
    }
    let next: Pivot;
    if (
      daily &&
      (!pivot ||
        (format !== "table" && !pivotFields(pivot).includes("measure")))
    ) {
      next = dailyLayout(format as Pivot["mark"], p.group);
    } else if (pivot) {
      next = { ...pivot };
    } else if (format === "table") {
      next = { row: "source", column: "slot" };
    } else {
      next = {
        row: "measure",
        column: "time:60",
        series: p.group === "all" ? [] : [p.group],
      };
    }
    if (format !== "table") configurePlotAxes(next);
    change({
      ...p,
      display: "pivot",
      values: p.values.map(({ mark: _, ...v }) => v),
      pivot: { ...next, mark: format as Pivot["mark"] },
    });
  }
  const multiple = p.values.length > 1;
  const worksheetId = useId();
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
  function unitInput(key: string, source = "") {
    const value = p.fieldUnits?.[key] ?? "";
    function write(text: string) {
      const fieldUnits = { ...p.fieldUnits };
      if (text.trim()) fieldUnits[key] = text.trim();
      else delete fieldUnits[key];
      change({ ...p, fieldUnits });
    }
    return <UnitInput source={source} value={value} write={write} />;
  }
  function timeSettings(id: Shelf, field: TimeField | "day", label: string) {
    if (!pivot) return;
    const interval = field === "day" ? "time:86400" : field;
    const zone = fieldZone(pivot, field);
    const fields = pivotFields(pivot);
    const storedField = (grain: TimeField, tz: TimeZone) =>
      grain === "time:86400" && tz === "JST" ? "day" : grain;
    const alreadyAssigned = (grain: TimeField, tz: TimeZone) => {
      const next = storedField(grain, tz);
      return next !== field && fields.includes(next);
    };
    const update = (grain: TimeField, zone: TimeZone) => {
      const next = storedField(grain, zone);
      const timeZones = { ...pivot.timeZones };
      delete timeZones[field];
      if (next !== "day" && next !== "time:86400") timeZones[next] = zone;
      const encoding = { ...pivot.encoding };
      for (const ch of Object.keys(encoding) as StyleChannel[])
        if (encoding[ch] === field) encoding[ch] = next;
      change({
        ...p,
        pivot: {
          ...pivot,
          timeZones,
          encoding,
          [id]: shelfFields(pivot[id]).map((k) => (k === field ? next : k)),
        },
      });
    };
    return (
      <>
        <label>
          区間単位
          <select
            aria-label={label + "の時刻の粒度"}
            value={interval}
            disabled={daily}
            onChange={(e) => update(e.target.value as TimeField, zone)}
          >
            {(Object.keys(timeBuckets) as TimeField[])
              .filter((k) => !daily || k === "time:86400")
              .map((k) => (
                <option key={k} value={k} disabled={alreadyAssigned(k, zone)}>
                  {intervalName(k)}
                </option>
              ))}
          </select>
        </label>
        <label>
          タイムゾーン
          <select
            aria-label={label + "のタイムゾーン"}
            value={zone}
            disabled={daily}
            onChange={(e) => update(interval, e.target.value as TimeZone)}
          >
            {(["JST", "UTC"] as const).map((z) => (
              <option key={z} disabled={alreadyAssigned(interval, z)}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </>
    );
  }
  const hasFieldSettings = (field: ShelfAxis) => isTemporalField(field);
  /** The shelf the values sit on, if any. */
  const measureShelf: Shelf | undefined = pivot
    ? shelves.find((id) => shelfFields(pivot[id]).includes("measure"))
    : p.display === "chart"
      ? "row"
      : undefined;
  function setValue(i: number, v: Value) {
    if (p.values.some((x, j) => j !== i && valueKey(x) === valueKey(v))) return;
    change({ ...p, values: p.values.map((x, j) => (j === i ? v : x)) });
  }
  /** Adds a value where the values are, or makes it the only value elsewhere. */
  function addValue(base: Panel, shelf: Shelf | undefined, v: Value): Panel {
    if (base.values.some((x) => valueKey(x) === valueKey(v)))
      return shelf && shelf !== measureShelf
        ? assign(base, shelf, "measure")
        : base;
    const onShelf =
      !!pivot && !!shelf && shelfFields(pivot[shelf]).includes("measure");
    if (onShelf) return { ...base, values: [...base.values, v].slice(0, 12) };
    if (!pivot && shelf === "row" && base.display === "chart")
      return assign(
        { ...base, values: [...base.values, v].slice(0, 12) },
        "row",
        "measure",
      );
    if (!shelf) return { ...base, values: [v] };
    return assign({ ...base, values: [v] }, shelf, "measure");
  }
  /** Adds a dimension to a distinct count, counting combinations. */
  function combine(i: number, field: Dimension): Panel {
    const v = p.values[i];
    return {
      ...p,
      values: p.values.map((x, j) =>
        j === i ? { agg: "distinct" as const, of: [...v.of, field] } : x,
      ),
    };
  }
  const distinctOf = (field: Dimension | TimeField): field is Dimension =>
    !isTemporalField(field) &&
    aggsFor(p.data, [field as Dimension]).includes("distinct");
  /** Whether a value may add up per-group averages (two-stage). */
  const canPer = (v: Value) =>
    p.data !== "daily" &&
    v.of.length === 1 &&
    (v.of[0] === "value" || metricOf(v.of[0]) !== undefined);
  function togglePer(i: number, v: Value, d: Dimension) {
    const per = v.per?.includes(d)
      ? v.per.filter((x) => x !== d)
      : [...(v.per ?? []), d];
    const next: Value = { ...v, per: per.length ? per : undefined };
    if (next.per && !perAggs.includes(next.agg)) next.agg = "avg";
    setValue(i, next);
  }
  function valueMenu(v: Value, i: number) {
    const id = valueTrigger(i).popoverTarget;
    const aggs = aggsFor(p.data, v.of).filter(
      (a) => !v.per?.length || perAggs.includes(a),
    );
    return (
      <fieldset
        id={id}
        popover="auto"
        className="metric-menu value-menu"
        aria-label={valueName(dict, p.data, v) + "の集計"}
      >
        {unitInput(valueKey(v), nativeUnit(dict, p, v))}
        {aggs.length > 1 && <span>集計</span>}
        {aggs.length > 1 &&
          aggs.map((agg) => (
            <button
              type="button"
              key={agg}
              aria-pressed={v.agg === agg}
              popoverTarget={id}
              popoverTargetAction="hide"
              onClick={() => setValue(i, { ...v, agg })}
            >
              {aggNames[agg]}
            </button>
          ))}
        {v.of.length > 1 && <span>組み合わせ</span>}
        {v.of.length > 1 &&
          v.of.map((f) => (
            <button
              type="button"
              key={f}
              popoverTarget={id}
              popoverTargetAction="hide"
              aria-label={
                valueFieldName(dict, p.data, f) + " を組み合わせから外す"
              }
              onClick={() =>
                setValue(i, { ...v, of: v.of.filter((x) => x !== f) })
              }
            >
              {valueFieldName(dict, p.data, f)} ×
            </button>
          ))}
        {canPer(v) && (
          <>
            <span title="選んだ単位ごとに1分ずつ平均してから合計し、その合計を集計します">
              合計する単位
            </span>
            {identifiers.map((d) => (
              <label key={d} className="inline">
                <input
                  type="checkbox"
                  checked={!!v.per?.includes(d)}
                  onChange={() => togglePer(i, v, d)}
                />
                {shelfName(d, dict)}ごと
              </label>
            ))}
          </>
        )}
        {v.of.length === 1 && (
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            onClick={() => editField(fieldKey(p.data, v.of[0]))}
          >
            名前と単位を設定
          </button>
        )}
      </fieldset>
    );
  }
  function valueTrigger(i: number) {
    return metricTrigger("value-" + i);
  }
  /** The values as chips; on a shelf they also carry the measure axis. */
  function valueChips(shelf?: Shelf) {
    const dimension = item?.kind === "dimension" ? item.key : undefined;
    return (
      <>
        {p.values.map((v, i) => {
          const target = "value/" + i;
          const label =
            v.agg === "count"
              ? countName
              : v.of.map((f) => valueFieldName(dict, p.data, f)).join(" × ");
          const agg =
            v.agg === "count"
              ? ""
              : v.of.length > 1
                ? "組の種類数"
                : v.per?.length
                  ? `${v.per.map((d) => shelfName(d, dict)).join("・")}ごとの合計の${aggNames[v.agg]}`
                  : aggNames[v.agg];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a value is edited in place; keying it by its definition would remount its open menu
            <Fragment key={`${i}:${v.of.join(",")}`}>
              <span
                className="shelf-chip value-chip"
                data-drop={
                  targets.some((t) => t.id === target) ? target : undefined
                }
                data-ready={
                  (dimension && targets.some((t) => t.id === target)) ||
                  undefined
                }
                data-preview={hovered?.id === target || undefined}
              >
                <button
                  type="button"
                  className={shelf ? "drag-source" : undefined}
                  title="クリックして集計を設定"
                  {...valueTrigger(i)}
                  onPointerDown={
                    shelf
                      ? (e) => drag.start(e, { kind: "placed", key: "measure" })
                      : undefined
                  }
                >
                  {label}
                </button>
                {agg && <small>{agg}</small>}
                {(p.values.length > 1 || (shelf && pivot)) && (
                  <button
                    type="button"
                    aria-label={valueName(dict, p.data, v) + " を外す"}
                    onClick={() =>
                      p.values.length > 1
                        ? change({
                            ...p,
                            values: p.values.filter((_, j) => j !== i),
                          })
                        : shelf && without(shelf, "measure")
                    }
                  >
                    ×
                  </button>
                )}
              </span>
              {valueMenu(v, i)}
            </Fragment>
          );
        })}
      </>
    );
  }
  /**
   * The values with one drop zone around them: a dimension dropped there is
   * counted as a new distinct value, the placed measure moves with it.
   */
  function valueGroup(shelf?: Shelf, index?: number) {
    const placed =
      item?.kind === "placed" && shelf && index !== undefined
        ? shelf + "/" + index
        : undefined;
    const counts =
      item?.kind === "dimension" && targets.some((t) => t.id === "value/new");
    return (
      <span
        className="shelf-chips value-chips"
        key="measure"
        data-drop={placed ?? (counts ? "value/new" : undefined)}
        data-ready={counts || undefined}
        data-preview={hovered?.id === "value/new" || undefined}
        title={counts ? "ここに落とすと種類数として追加" : undefined}
      >
        {valueChips(shelf)}
      </span>
    );
  }
  function without(id: Shelf, field: ShelfAxis) {
    if (!pivot) return;
    change({
      ...p,
      pivot: {
        ...pivot,
        [id]: shelfFields(pivot[id]).filter((k) => k !== field),
      },
    });
  }
  const update = <K extends keyof Panel>(key: K, value: Panel[K]) =>
    change({ ...p, [key]: value });
  const [openFilter, openConditions] = useState<FilterField>();
  const conditions: FieldCondition[] = [...(p.conditions ?? [])];
  function writeFilter(field: FilterField, next?: FieldCondition) {
    const values = [...(p.conditions ?? [])];
    const index = values.findIndex((c) => c.field === field);
    if (index >= 0) values.splice(index, 1, ...(next ? [next] : []));
    else if (next) values.push(next);
    change({ ...p, conditions: values.length ? values : undefined });
  }
  function addFilter(field: FilterField) {
    if (isTemporalField(field))
      field = conditions.find((c) => isTemporalField(c.field))?.field ?? field;
    if (!conditions.some((c) => c.field === field))
      writeFilter(field, { field });
    openConditions(field);
  }
  const filterFields: [FilterField, string][] = [...fields];
  if (!daily) filterFields.push(["text", shelfName("text", dict)]);
  const stylePivot: Pivot | undefined =
    (pivot && { ...pivot }) ||
    (p.display === "chart"
      ? {
          row: "measure",
          column: daily ? "day" : "time:60",
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
                  !isTemporalField(f) &&
                  !shelfFields(
                    stylePivot[valueSide === "row" ? "column" : "row"],
                  ).includes(f),
              ),
          ]),
        )
      : [];
  const legacyMarks = new Set(
    pivot && multiple
      ? p.values.map((v) => v.mark ?? pivot.mark ?? "table")
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
  const visibleAxes: Shelf[] = grouped
    ? []
    : format === "table"
      ? shelves
      : ["column", "row"];
  const valueSlot =
    grouped ||
    (format === "table" && pivot && !pivotFields(pivot).includes("measure"));
  const groupChoices: [string, string][] = [
    ["all", "全体"],
    ...fields.filter(([k]) => !isTemporalField(k)),
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
    | { kind: "text"; key: "text" }
    | { kind: "value"; key: ValueField | "" }
    | { kind: "dimension"; key: Dimension | TimeField }
    | { kind: "placed"; key: ShelfAxis };
  function candidates(field: Field, position?: number) {
    const options: {
      id: string;
      label: string;
      panel?: Panel;
      filter?: FilterField;
    }[] = [];
    if (field.kind === "text")
      return [
        ...options,
        { id: "filter", label: "フィルター", filter: "text" as const },
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
        (isTemporalField(field.key) ||
          filterFields.some(([k]) => k === field.key))
      )
        options.push({ id: "filter", label: "フィルター", filter: field.key });
      return options;
    }
    if (field.kind === "value") {
      const v = valueFor(field.key);
      if (valueSlot)
        options.push({
          id: "measure",
          label: "値",
          panel: { ...p, values: [v] },
        });
      for (const id of visibleAxes)
        options.push({
          id,
          label: axisLabels[id],
          panel: addValue(p, id, v),
        });
      return options;
    }
    const key =
      isTemporalField(field.key) && pivot
        ? (pivotFields(pivot).find(isTemporalField) ?? field.key)
        : field.key;
    if (distinctOf(key) && (valueSlot || measureShelf)) {
      p.values.forEach((v, i) => {
        if (v.agg === "distinct" && !v.of.includes(key))
          options.push({
            id: "value/" + i,
            label: valueName(dict, p.data, v) + "に組み合わせる",
            panel: combine(i, key as Dimension),
          });
      });
      const v: Value = { agg: "distinct", of: [key as Dimension] };
      options.push({
        id: "value/new",
        label: "種類数として追加",
        panel: valueSlot ? { ...p, values: [v] } : addValue(p, measureShelf, v),
      });
    }
    for (const id of visibleAxes)
      options.push({ id, label: axisLabels[id], panel: assign(p, id, key) });
    if (grouped && !isTemporalField(key))
      options.push({ id: "group", label: "分類", panel: changeGroup(p, key) });
    if (isTemporalField(key) || filterFields.some(([k]) => k === key))
      options.push({ id: "filter", label: "フィルター", filter: key });
    return options;
  }
  const drag = useDropPreview<Field>((field, id) => {
    const [role, pos] = id.split("/");
    const options = candidates(
      field,
      pos === undefined ? undefined : Number(pos),
    );
    const option =
      options.find((o) => o.id === id) ?? options.find((o) => o.id === role);
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
  const hovered =
    targets.find((o) => o.id === drag.preview?.target) ??
    targets.find((o) => o.id === targetRole);
  const candidate = hovered?.panel && normalized(hovered.panel);
  const preview = candidate ?? p;
  const fieldName = !item
    ? undefined
    : item.kind === "value"
      ? item.key
        ? valueFieldName(dict, p.data, item.key)
        : countName
      : isTemporalField(item.key)
        ? "時刻"
        : shelfName(item.key, dict);

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
          <button className="panel-cancel" type="button" onClick={cancelPanel}>
            キャンセル
          </button>
          <button
            className="primary"
            type="button"
            title={
              directSave
                ? "パネルを保存してダッシュボードに戻る"
                : "パネルの編集を確定して配置に戻る"
            }
            disabled={!p.title.trim()}
            onClick={savePanel}
          >
            セーブ
          </button>
          <button
            type="button"
            className="panel-actions-trigger"
            popoverTarget={worksheetId + "-actions"}
            aria-label="パネル操作"
            title="パネル操作"
          >
            ⋯
          </button>
          <div
            className="panel-actions-menu"
            id={worksheetId + "-actions"}
            popover="auto"
          >
            {actions}
          </div>
        </div>
      </div>
      <div className="builder" {...drag.bind}>
        {item && (
          <span className="drag-ghost" aria-hidden="true">
            {fieldName}
          </span>
        )}
        <div className="builder-main">
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
            threshold={threshold}
            renderStyleDialog={
              channels.length && (p.display === "chart" || !!valueSide)
                ? (points, close) => (
                    <LegendStyleDialog
                      panel={p}
                      points={points}
                      channels={channels}
                      encoding={encoding}
                      close={close}
                      save={(channel, value, index) => {
                        if (value === undefined) {
                          const defaults = { ...p.styleDefaults },
                            legacy = { ...p.fixedStyle };
                          delete legacy[channel];
                          if (index === undefined) delete defaults[channel];
                          else defaults[channel] = index;
                          change({
                            ...p,
                            styleDefaults: defaults,
                            fixedStyle: legacy,
                          });
                        } else {
                          const base = withStyle(channel, encoding[channel]);
                          if (!base.pivot) return;
                          const rules = (base.pivot.styleRules ?? []).filter(
                            (r) => r.channel !== channel || r.value !== value,
                          );
                          if (index !== undefined)
                            rules.push({ channel, value, index });
                          change({
                            ...base,
                            styleDefaults:
                              !p.pivot?.encoding?.[channel] &&
                              p.styleDefaults?.[channel] === undefined &&
                              p.fixedStyle?.[channel] !== undefined
                                ? {
                                    ...p.styleDefaults,
                                    [channel]: p.fixedStyle[channel],
                                  }
                                : p.styleDefaults,
                            pivot: { ...base.pivot, styleRules: rules },
                          });
                        }
                      }}
                    />
                  )
                : undefined
            }
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
            <FilterShelf
              panel={{
                ...p,
                minutes,
                ...Object.fromEntries(
                  identifiers
                    .filter((k) => k === openFilter)
                    .map((k) => [k, ""]),
                ),
              }}
              end={end}
              items={conditions}
              fields={filterFields}
              open={openFilter}
              setOpen={openConditions}
              add={addFilter}
              change={(c) => writeFilter(c.field, c)}
              changeTimeField={(previous, next) => {
                writeFilter(previous, next);
                openConditions(next.field);
              }}
              remove={(k) => {
                writeFilter(k);
                if (openFilter === k) openConditions(undefined);
              }}
              ready={targets.some((t) => t.id === "filter")}
              hover={targetRole === "filter"}
            />
            <fieldset
              className="worksheet-shelves"
              aria-label="フィールドの割り当て"
            >
              {visibleAxes.map((id) => {
                const assigned = pivot ? shelfFields(pivot[id]) : [];
                const label = axisLabels[id];
                const implicit = pivot ? "" : id === "column" ? "時刻" : "値";
                const opts: [string, string][] = [
                  ...fields.map(([k, v]): [string, string] => ["axis/" + k, v]),
                  ...measurable.map(([k, v]): [string, string] => [
                    "value/" + k,
                    v,
                  ]),
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
                    <ShelfTarget
                      label={label}
                      name={label + "にフィールドを追加"}
                      open={() => openPicker(id)}
                      hint={
                        !assigned.length && !implicit
                          ? "ここにドロップ"
                          : undefined
                      }
                    />
                    {!pivot &&
                      implicit &&
                      (id === "row" ? (
                        valueGroup()
                      ) : (
                        <span className="shelf-chip">
                          <button type="button" onClick={() => openPicker(id)}>
                            {implicit}
                          </button>
                        </span>
                      ))}
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
                            : {
                                kind: "value",
                                key: v.slice(6) as ValueField | "",
                              };
                          const next = candidates(f).find(
                            (c) => c.id === id,
                          )?.panel;
                          if (next) change(next);
                        }}
                      />
                    )}
                    {pivot && (
                      <div className="shelf-chips">
                        {assigned.map((field, i) =>
                          field === "measure" ? (
                            valueGroup(id, i)
                          ) : (
                            <span
                              className="shelf-chip"
                              key={isTemporalField(field) ? "time-" + i : field}
                              data-drop={
                                item?.kind === "placed"
                                  ? id + "/" + i
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                className="drag-source"
                                title={
                                  hasFieldSettings(field)
                                    ? "クリックして表示設定を変更"
                                    : "ドラッグまたは Alt＋左右矢印で移動"
                                }
                                {...(hasFieldSettings(field)
                                  ? metricTrigger(id + "/" + i)
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
                                {isTemporalField(field)
                                  ? "時刻"
                                  : shelfName(field, dict)}
                              </button>
                              {isTemporalField(field) && (
                                <fieldset
                                  popover="auto"
                                  className="metric-menu"
                                  id={metricTrigger(id + "/" + i).popoverTarget}
                                >
                                  {timeSettings(id, field, label)}
                                </fieldset>
                              )}
                              {isTemporalField(field) && (
                                <small>
                                  {intervalName(field)} ·{" "}
                                  {fieldZone(pivot, field)}
                                </small>
                              )}
                              <button
                                type="button"
                                aria-label={
                                  shelfName(field, dict) +
                                  " を" +
                                  label +
                                  "から外す"
                                }
                                onClick={() => without(id, field)}
                              >
                                ×
                              </button>
                            </span>
                          ),
                        )}
                      </div>
                    )}
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
                  <ShelfTarget
                    label="値"
                    name="値にフィールドを追加"
                    open={() => openPicker("measure")}
                  />
                  {valueGroup()}
                  {picker === "measure" && (
                    <ShelfPicker
                      label="値"
                      choices={measurable}
                      close={() => openPicker(undefined)}
                      select={(k) =>
                        change({
                          ...p,
                          values: [valueFor(k as ValueField | "")],
                        })
                      }
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
                  <ShelfTarget
                    label="分類"
                    name="分類にフィールドを追加"
                    open={() => openPicker("group")}
                  />
                  <span className="shelf-chip">
                    <button type="button" onClick={() => openPicker("group")}>
                      {groupChoices.find(([key]) => key === p.group)?.[1] ??
                        p.group}
                    </button>
                    {p.group !== "all" && (
                      <button
                        type="button"
                        aria-label="分類の割り当てを外す"
                        onClick={() => change(changeGroup(p, "all"))}
                      >
                        ×
                      </button>
                    )}
                  </span>
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
                  const index =
                    p.styleDefaults?.[channel] ?? p.fixedStyle?.[channel];
                  const removable =
                    !!field ||
                    (channel === "color" && p.fixedStyle?.color !== undefined);
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
                      <ShelfTarget
                        label={label}
                        name={label + "に属性を割り当て"}
                        disabled={!styleFields.length}
                        open={() => openPicker(channel)}
                        hint={
                          !field && index === undefined
                            ? styleFields.length
                              ? "ここにドロップ"
                              : "既定"
                            : undefined
                        }
                      />
                      {(field || index !== undefined) && (
                        <span
                          className="shelf-chip"
                          data-assigned={removable || undefined}
                        >
                          <button
                            type="button"
                            disabled={!styleFields.length}
                            onClick={() => openPicker(channel)}
                          >
                            {field
                              ? shelfName(field, dict)
                              : styleNames[channel][index!]}
                          </button>
                          {removable && (
                            <button
                              type="button"
                              aria-label={label + "の割り当てを外す"}
                              onClick={() => change(withStyle(channel))}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      )}
                      {picker === channel && (
                        <ShelfPicker
                          label={label}
                          choices={styleFields.map((f) => [
                            f,
                            shelfName(f, dict),
                          ])}
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
                    aria-label={shelfName(f, dict) + "の分類を解除"}
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
                    {shelfName(f, dict)} ×
                  </button>
                ))}
              </fieldset>
            )}
            {rule}
          </div>
        </section>
        <div className="worksheet-format">
          <Select
            label="表示形式"
            value={format}
            choices={[
              ...(format === "mixed"
                ? [["mixed", "保存済みの複合表示"] as [string, string]]
                : []),
              ["auto", "自動"],
              ["line", "折れ線"],
              ["bar", "棒"],
              ["area", "エリアグラフ"],
              ["stacked_area", "積み上げ面"],
              ["table", "ピボット表"],
              ...(multiple
                ? []
                : ([
                    ["summary", "集計表"],
                    ["value", "数値"],
                  ] as [string, string][])),
            ]}
            change={setFormat}
          />
        </div>
        <div className="field-catalog">
          <Select
            label="データ"
            value={p.data}
            choices={Object.entries(dataKinds)}
            change={(v) => change(withData(p, v as DataKind))}
          />
          <label>
            フィールドを検索
            <input
              type="search"
              value={search}
              onChange={(e) => find(e.target.value)}
              placeholder="名前・属性キー"
            />
          </label>
          <div className="catalog-list">
            <h4>測れるもの</h4>
            {measurable
              .filter(([k, v]) =>
                (k + v).toLowerCase().includes(search.toLowerCase()),
              )
              .map(([k, v]) => (
                <button
                  type="button"
                  key={k || "count"}
                  className="drag-source"
                  title="縦軸へドラッグ、またはクリックして値に追加"
                  onPointerDown={(e) =>
                    drag.start(e, { kind: "value", key: k })
                  }
                  aria-pressed={p.values.some((x) =>
                    k ? x.of.length === 1 && x.of[0] === k : x.agg === "count",
                  )}
                  onClick={() =>
                    change(
                      valueSlot
                        ? { ...p, values: [valueFor(k)] }
                        : addValue(p, measureShelf ?? "row", valueFor(k)),
                    )
                  }
                >
                  {v}
                </button>
              ))}
            {!measurable.length && (
              <p className="catalog-empty">
                {p.data === "daily"
                  ? "日次集合がまだ届いていません"
                  : "このデータには測れる値がありません"}
              </p>
            )}
            <h4>分けるもの</h4>
            {!daily && shelfName("text", dict).includes(search) && (
              <button
                type="button"
                className="drag-source"
                title="本文や名前に含む文字列で絞り込む"
                onPointerDown={(e) =>
                  drag.start(e, { kind: "text", key: "text" })
                }
                onClick={() => addFilter("text")}
              >
                {shelfName("text", dict)}
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
                      if (!isTemporalField(k)) change(changeGroup(p, k));
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
      </div>
    </>
  );
}
