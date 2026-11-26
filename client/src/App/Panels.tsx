import { useLayoutEffect, useRef, useState } from "react";
import type { Overview, Panel, Point } from "../../../shared/console";
import {
  aggNames,
  aggsFor,
  changeGroup,
  chartBucketSeconds,
  countsWhole,
  type DataKind,
  dataKinds,
  defaultAgg,
  defaultTotalSlots,
  initialValue,
  isAttribute,
  isTimeField,
  measurableFields,
  metricOf,
  pivotFields,
  type ShelfAxis,
  shelfFields,
  shelfName,
  slotTotalChoice,
  type ValueField,
  valueAt,
  valueFieldName,
  valueName,
} from "../../../shared/console";
import { clock, Feedback, number, useQuery } from "../api";
import { countAxis } from "./countAxis";
import { displayField, displayPoints, nativeUnit } from "./fieldDisplay";
import { InspectablePlot } from "./InspectablePlot";
import { dashPatterns, lineWidths, PointSymbol, palette } from "./SeriesStyle";
import { WorksheetPlot } from "./WorksheetPlot";

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
  const value = p.values[0];
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
        label="データ"
        value={p.data}
        choices={(Object.entries(dataKinds) as [DataKind, string][]).filter(
          ([k]) => k !== "daily",
        )}
        change={(v) => {
          const data = v as DataKind;
          set({
            ...p,
            data,
            values: [initialValue(data, meta)],
            group: p.group === "slot_total" ? "source" : p.group,
            unit: undefined,
          });
        }}
      />
      <Select
        label="値"
        value={value.of.join(",")}
        choices={[
          ...(aggsFor(p.data, []).length
            ? [
                ["", valueName(p.data, { agg: "count", of: [] })] as [
                  string,
                  string,
                ],
              ]
            : []),
          ...measurableFields(p.data, meta).map((f): [string, string] => [
            f,
            valueFieldName(p.data, f),
          ]),
        ]}
        change={(v) => {
          const of = v ? [v as ValueField] : [];
          set({
            ...p,
            values: [{ agg: defaultAgg(p.data, of), of }],
            unit: undefined,
          });
        }}
      />
      {aggsFor(p.data, value.of).length > 1 && (
        <Select
          label="集計"
          value={value.agg}
          choices={aggsFor(p.data, value.of)
            .filter(
              (a) =>
                p.group !== "slot_total" || ["avg", "min", "max"].includes(a),
            )
            .map((a): [string, string] => [a, aggNames[a]])}
          change={(v) =>
            set({ ...p, values: [{ ...value, agg: v as typeof value.agg }] })
          }
        />
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
          ...(p.data === "metric" ? [slotTotalChoice] : []),
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
  whole,
  unit,
  fixedStyle,
  legendAction,
  formatTime = clock,
  gapMs = Infinity,
  points,
  start,
  end,
  choose,
}: {
  /** Whether the values count things, so the axis uses whole numbers. */
  whole: boolean;
  unit?: string;
  fixedStyle?: Panel["fixedStyle"];
  legendAction?: React.ReactNode;
  gapMs?: number;
  formatTime?: (stamp: string) => string;
  points: Point[];
  start: number;
  end: number;
  choose?: (p: Point) => string;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, resize] = useState(610);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measureWidth = () => resize(Math.max(100, el.clientWidth));
    measureWidth();
    const observer = new ResizeObserver(measureWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const color = (i: number) =>
    fixedStyle?.color === undefined
      ? colors[i % colors.length]
      : palette[fixedStyle.color];
  const strokeWidth = lineWidths[fixedStyle?.width ?? 1],
    dash = dashPatterns[fixedStyle?.dash ?? 0],
    shape = fixedStyle?.shape ?? 0;
  const groups = Array.from(new Set(points.map((p) => p.series)));
  const [active, setActive] = useState("");
  const shown =
    active && groups.includes(active)
      ? points.filter((p) => p.series === active)
      : points;
  const low = shown.reduce((v, p) => Math.min(v, p.value), 0);
  const maximum = shown.reduce((v, p) => Math.max(v, p.value), low + 1);
  const counts = countAxis(whole, maximum);
  const high = counts?.maximum ?? maximum;
  const labels = counts?.ticks ?? [low, (low + high) / 2, high];
  const valueY = (value: number) => 135 - (112 * (value - low)) / (high - low);
  const left = Math.max(...labels.map((n) => number(n).length)) * 6 + 8;
  const right = Math.max(left + 1, width - 5);
  const x = (p: Point) =>
    left +
    (right - left) *
      Math.max(0, Math.min(1, (Date.parse(p.bucket) - start) / (end - start)));
  const buckets = new Map<string, Map<string, Point>>();
  for (const p of shown) {
    const bucket = buckets.get(p.bucket) ?? new Map<string, Point>();
    bucket.set(p.series, p);
    buckets.set(p.bucket, bucket);
  }
  const y = (p: Point) => valueY(p.value);
  return (
    <div className="chart-with-legend">
      <div ref={frame}>
        <InspectablePlot
          viewBox={`0 0 ${width} 155`}
          label="集計値の推移"
          bounds={{ left, right, top: 23, bottom: 135 }}
          samples={Array.from(buckets, ([key, values]) => ({
            key,
            position: x(values.values().next().value!),
          })).sort((a, b) => a.position - b.position)}
          heading={formatTime}
          readings={(key) =>
            groups.flatMap((group, i) => {
              if (active && groups.includes(active) && active !== group)
                return [];
              const p = buckets.get(key)?.get(group);
              return [
                {
                  id: group,
                  label: group || "未指定",
                  value: p?.value,
                  unit: p?.metricUnit ?? unit,
                  color: color(i),
                },
              ];
            })
          }
        >
          {labels.map((n) => (
            <g key={n}>
              <line
                x1={left}
                x2={right}
                y1={valueY(n)}
                y2={valueY(n)}
                stroke="#dae5e3"
              />
              <text x={left - 5} y={valueY(n) + 3} textAnchor="end">
                {number(n)}
              </text>
            </g>
          ))}
          {groups.map((g, i) => {
            const ps = shown.filter((p) => p.series === g);
            return (
              <g key={g} stroke={color(i)} fill={color(i)}>
                <path
                  fill="none"
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  strokeLinecap="round"
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
                    <PointSymbol
                      key={p.bucket}
                      shape={shape}
                      x={x(p)}
                      y={y(p)}
                      r={3}
                    >
                      <title>
                        {formatTime(p.bucket)} · {g} · {number(p.value)}
                      </title>
                    </PointSymbol>
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
        </InspectablePlot>
        <div className="range">
          <span>{formatTime(new Date(start).toISOString())}</span>
          <span>{formatTime(new Date(end).toISOString())}</span>
        </div>
      </div>
      <div className="legend">
        {legendAction}
        {groups.length > 1 &&
          groups.map((g, i) => (
            <button
              type="button"
              key={g}
              style={{ borderLeftColor: color(i) }}
              aria-pressed={active === g}
              onClick={() => setActive(active === g ? "" : g)}
            >
              <svg
                aria-hidden="true"
                className="legend-key"
                viewBox="0 0 32 12"
                fill={color(i)}
              >
                <line
                  x1="1"
                  y1="6"
                  x2="31"
                  y2="6"
                  stroke={color(i)}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                />
                <PointSymbol shape={shape} x={16} y={6} r={3} />
              </svg>
              {g || "未指定"}
            </button>
          ))}
      </div>
    </div>
  );
}
function commonTableUnit(points: Point[]) {
  const unit = points[0]?.metricUnit;
  return unit && points.every((p) => p.metricUnit === unit) ? unit : "";
}
function tableValue(point: Point, commonUnit: string) {
  return [number(point.value), commonUnit ? "" : point.metricUnit]
    .filter(Boolean)
    .join(" ");
}
export function PanelView({
  panel,
  end,
  actions,
  heading,
  onEdit,
  choose,
  renderStyleDialog,
}: {
  panel: Panel;
  end: string;
  actions?: React.ReactNode;
  renderStyleDialog?: (points: Point[], close: () => void) => React.ReactNode;
  heading?: React.ReactNode;
  onEdit?: () => void;
  choose?: (p: Point) => string;
}) {
  const [editingStyles, editStyles] = useState(false);
  const legendAction = renderStyleDialog && (
    <div className="legend-tools">
      <strong>凡例</strong>
      <button
        type="button"
        aria-label="凡例のスタイルを編集"
        onClick={() => editStyles(true)}
      >
        スタイルを編集
      </button>
    </div>
  );
  const { data: rawPoints, error } = useQuery<Point[]>("series", {
    panel: {
      ...panel,
      fixedStyle: undefined,
      styleDefaults: undefined,
      pivot: panel.pivot
        ? {
            ...panel.pivot,
            encoding: undefined,
            styleRules: undefined,
            timeZones: undefined,
          }
        : undefined,
      wide: undefined,
      title: "プレビュー",
    },
    end,
    buckets: panel.display === "chart",
  });
  const data = rawPoints && displayPoints(panel, rawPoints);
  const tableUnit =
    panel.display === "table" && data ? commonTableUnit(data) : "";
  const unit = data?.[0]?.metricUnit ?? panel.unit;
  return (
    <article className="card">
      <div className="cardhead">
        <h3>
          {heading ??
            (onEdit ? (
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
            ))}
        </h3>
        {actions}
      </div>
      <small>
        {dataKinds[panel.data]} ·{" "}
        {panel.values.map((v) => valueName(panel.data, v)).join("・")} ·{" "}
        {panel.source || "全サービス"} · {panel.minutes}分{" "}
        {panel.display !== "table" && panel.values.length === 1 && unit}
        {panel.display === "chart" &&
          panel.values[0].agg === "count" &&
          ` · ${chartBucketSeconds(panel.minutes)}秒ごとの件数`}
        {panel.data === "daily" &&
          " · サービス別・日別のユニーク数（複数をまとめた値は延べ件数）"}
        {panel.group === "slot_total" &&
          ` · ${(panel.totalSlots ?? defaultTotalSlots).join(" + ")}（全スロットを観測した分のみ）`}
      </small>
      {!data ? (
        <p role="status">
          <Feedback error={error} />
        </p>
      ) : data.length === 0 ? (
        <p className="empty">
          {panel.data === "request"
            ? "この条件で受信した server span がありません。期間またはサービスを変更してください。"
            : "この期間と絞り込み条件に一致するデータがありません。"}
        </p>
      ) : panel.display === "pivot" && panel.pivot ? (
        <PivotView
          panel={panel}
          points={data}
          end={end}
          legendAction={legendAction}
        />
      ) : panel.display === "chart" ? (
        <Chart
          whole={countsWhole(panel.data, panel.values[0])}
          unit={unit ?? nativeUnit(panel)}
          legendAction={legendAction}
          fixedStyle={{ ...panel.fixedStyle, ...panel.styleDefaults }}
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
              <th>{tableUnit ? `値（${tableUnit}）` : "値"}</th>
              <th>サンプル</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.series}>
                <td>{p.series}</td>
                <td>{tableValue(p, tableUnit)}</td>
                <td>{p.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!data?.length && legendAction}
      {editingStyles &&
        renderStyleDialog?.(data ?? [], () => editStyles(false))}
    </article>
  );
}

export function investigatePanel(p: Panel, end: string) {
  const logContains = p.conditions?.find((c) => c.field === "log")?.contains;
  return (
    "#" +
    new URLSearchParams({
      page:
        p.data === "event"
          ? "events"
          : p.data === "log"
            ? "logs"
            : p.data === "metric"
              ? "metrics"
              : "apm",
      source: p.source,
      slot: p.slot,
      instance: p.instance,
      workload: p.workload,
      revision: p.revision,
      text: p.text,
      ...(p.conditions?.length && p.data === "event"
        ? { conditions: JSON.stringify(p.conditions) }
        : {}),
      ...(logContains ? { logContains } : {}),
      minutes: String(p.minutes),
      metric: metricOf(p.values[0].of[0]) ?? "",
      end,
    }).toString()
  );
}
function PivotView({
  panel,
  points,
  end,
  legendAction,
}: {
  panel: Panel;
  points: Point[];
  end: string;
  legendAction?: React.ReactNode;
}) {
  const pivot = panel.pivot!;
  const row = shelfFields(pivot.row),
    column = shelfFields(pivot.column);
  if (
    (row.includes("measure") && column.length) ||
    (column.includes("measure") && row.length)
  ) {
    const measureRow = row.includes("measure"),
      index = (measureRow ? row : column).indexOf("measure");
    const plot: Point[] = [],
      table: Point[] = [];
    for (const point of points) {
      const key = measureRow
        ? (point.rowPath ?? [point.series])[index]
        : (point.columnPath ?? [point.column ?? ""])[index];
      const mark = valueAt(panel, key).mark ?? pivot.mark ?? "table";
      (mark === "table" ? table : plot).push(point);
    }
    return (
      <>
        {!!plot.length && (
          <WorksheetPlot
            panel={panel}
            points={plot}
            legendAction={legendAction}
          />
        )}
        {!!table.length && (
          <FacetTable panel={panel} points={table} end={end} />
        )}
      </>
    );
  }
  return <FacetTable panel={panel} points={points} end={end} />;
}
function FacetTable({
  panel,
  points,
  end,
}: {
  panel: Panel;
  points: Point[];
  end: string;
}) {
  const pivot = panel.pivot!;
  const axis = shelfFields(pivot.series);
  if (!axis.length)
    return <PivotTable panel={panel} points={points} end={end} />;
  const facets = new Map<string, Point[]>();
  for (const p of points) {
    const key = p.facet ?? "";
    const rows = facets.get(key);
    if (rows) rows.push(p);
    else facets.set(key, [p]);
  }
  return (
    <>
      {Array.from(facets, ([key, rows]) => (
        <section key={key}>
          <h4>
            {axis.map(shelfName).join(" › ")} ·{" "}
            {axis
              .map((f, i) =>
                displayField(panel, f, rows[0].facetPath?.[i] ?? key),
              )
              .join(" › ") || "未指定"}
          </h4>
          <PivotTable panel={panel} points={rows} end={end} />
        </section>
      ))}
    </>
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
  const tableUnit = commonTableUnit(points);
  const rowFields = shelfFields(pivot.row),
    colFields = shelfFields(pivot.column);
  const rows = new Map<string, Map<string, Point>>();
  const rowPaths = new Map<string, string[]>(),
    columnPaths = new Map<string, string[]>();
  for (const point of points) {
    const col = point.column ?? "";
    rowPaths.set(
      point.series,
      point.rowPath ?? [rowFields.length ? point.series : "合計"],
    );
    columnPaths.set(col, point.columnPath ?? [colFields.length ? col : "合計"]);
    if (!rows.has(point.series)) rows.set(point.series, new Map());
    rows.get(point.series)?.set(col, point);
  }
  if (rows.size * columnPaths.size > 4000)
    return <p>表が大きすぎます。期間またはサービスを絞ってください。</p>;
  function hierarchy(paths: Map<string, string[]>) {
    const entries = Array.from(paths, ([key, values]) => ({
      key,
      values,
      spans: values.map(() => 0),
    }));
    entries.sort((a, b) => {
      for (let i = 0; i < a.values.length; i++) {
        const x = a.values[i],
          y = b.values[i];
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    });
    const starts: number[] = [];
    entries.forEach(({ values }, i) => {
      let same = i > 0;
      values.forEach((v, level) => {
        same = same && entries[i - 1].values[level] === v;
        if (!same) starts[level] = i;
        entries[starts[level]].spans[level]++;
      });
    });
    return entries;
  }
  const rowHeaders = hierarchy(rowPaths),
    colHeaders = hierarchy(columnPaths);
  const columnDepth = Math.max(1, colFields.length);
  const cellLink = (row: string[], col: string[]) => {
    const p = { ...panel };
    let until = end;
    const entries: [ShelfAxis, string][] = [
      ...rowFields.map((f, i): [ShelfAxis, string] => [f, row[i]]),
      ...colFields.map((f, i): [ShelfAxis, string] => [f, col[i]]),
    ];
    shelfFields(pivot.series).forEach((field, i) => {
      entries.push([
        field,
        points[0]?.facetPath?.[i] ?? points[0]?.facet ?? "",
      ]);
    });
    for (const [axis, val] of entries) {
      if (!axis) continue;
      if (isAttribute(axis)) {
        p.conditions = [
          ...(p.conditions ?? []).filter((c) => c.field !== axis),
          { field: axis, values: [val] },
        ];
        continue;
      }
      if ((isTimeField(axis) || axis === "day") && p.data === "event") {
        const start = Date.parse(
          axis === "day" ? val + "T00:00:00+09:00" : val,
        );
        const width = axis === "day" ? 86400000 : Number(axis.slice(5)) * 1000;
        const field = "time:1";
        const prior = p.conditions?.find((c) => c.field === field);
        p.conditions = [
          ...(p.conditions ?? []).filter((c) => c.field !== field),
          {
            field,
            min: Math.max(start, prior?.min ?? start),
            max: Math.min(start + width - 1, prior?.max ?? start + width - 1),
          },
        ];
        continue;
      }
      if (isTimeField(axis)) {
        const seconds = Number(axis.slice(5));
        until = new Date(
          Math.min(Date.parse(end), Date.parse(val) + seconds * 1000 - 1),
        ).toISOString();
        p.minutes = Math.max(1, Math.ceil(seconds / 60));
        continue;
      }
      if (axis === "measure") {
        p.values = [valueAt(p, val)];
        continue;
      }
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
          {Array.from({ length: columnDepth }, (_, level) => (
            <tr key={colFields[level] ?? "total"}>
              {level === 0 && (
                <th
                  rowSpan={columnDepth}
                  colSpan={Math.max(1, rowFields.length)}
                >
                  {rowFields.map(shelfName).join(" › ") || "合計"} ／{" "}
                  {colFields.map(shelfName).join(" › ") || "合計"}
                  {tableUnit && <small>値（{tableUnit}）</small>}
                </th>
              )}
              {colHeaders
                .filter((c) => c.spans[level])
                .map((c) => (
                  <th
                    key={c.key}
                    scope={level === columnDepth - 1 ? "col" : "colgroup"}
                    colSpan={c.spans[level]}
                  >
                    {displayField(panel, colFields[level], c.values[level]) ||
                      "未指定"}
                  </th>
                ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {rowHeaders.map((r) => (
            <tr key={r.key}>
              {r.values.map(
                (v, i) =>
                  r.spans[i] > 0 && (
                    <th
                      key={rowFields[i] ?? "total"}
                      scope="row"
                      rowSpan={r.spans[i]}
                    >
                      {displayField(panel, rowFields[i], v) || "未指定"}
                    </th>
                  ),
              )}
              {colHeaders.map((c) => {
                const p = rows.get(r.key)?.get(c.key);
                const value = p ? tableValue(p, tableUnit) : "—";
                return (
                  <td key={c.key}>
                    {p &&
                    (panel.data === "daily" ||
                      (panel.data !== "event" &&
                        pivotFields(pivot).some(isAttribute))) ? (
                      value
                    ) : p ? (
                      <a
                        href={cellLink(r.values, c.values)}
                        aria-label={
                          [
                            ...r.values.map((v, i) =>
                              displayField(panel, rowFields[i], v),
                            ),
                            ...c.values.map((v, i) =>
                              displayField(panel, colFields[i], v),
                            ),
                          ].join(" ") + " の詳細"
                        }
                      >
                        {value}
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
