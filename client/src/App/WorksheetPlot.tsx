import { useState } from "react";
import {
  countsWhole,
  fieldZone,
  isTemporalField,
  type Panel,
  type Point,
  type ShelfAxis,
  type StyleChannel,
  shelfFields,
  shelfName,
  valueAt,
  valueName,
} from "../../../shared/console";
import { number } from "../api";
import { countAxis } from "./countAxis";
import { useDictionary } from "./dictionary";
import { displayField, nativeUnit } from "./fieldDisplay";
import { InspectablePlot } from "./InspectablePlot";
import { dashPatterns, lineWidths, PointSymbol, palette } from "./SeriesStyle";

const ticks = [0, 0.25, 0.5, 0.75, 1];
const isStacked = (format: string) =>
  format === "stacked_area" || format === "area";
export function WorksheetPlot({
  panel,
  points,
  legendAction,
}: {
  panel: Panel;
  points: Point[];
  legendAction?: React.ReactNode;
}) {
  const dict = useDictionary();
  const [focused, focus] = useState("");
  const pivot = panel.pivot!;
  const rows = shelfFields(pivot.row),
    columns = shelfFields(pivot.column),
    facets = shelfFields(pivot.series);
  const horizontal = columns.includes("measure");
  const valueFields = horizontal ? columns : rows,
    categoryFields = horizontal ? rows : columns;
  const temporal =
    categoryFields.length === 1 && isTemporalField(categoryFields[0]);
  type Mark = { category: string; value: number };
  const groups = new Map<
    string,
    {
      labelParts: string[];
      unit: string;
      marks: Mark[];
      format: string;
      dimensions: Map<ShelfAxis, string>;
    }
  >();
  const categories = new Map<string, string>();
  for (const p of points) {
    const row = p.rowPath ?? [p.series],
      col = p.columnPath ?? [p.column ?? ""];
    const values = horizontal ? col : row,
      category = horizontal ? row : col;
    const facet = p.facetPath ?? [p.facet ?? ""];
    const key = JSON.stringify([values, facet]);
    const categoryKey = JSON.stringify(category);
    const value = valueAt(panel, values[valueFields.indexOf("measure")]);
    const unit = p.metricUnit ?? nativeUnit(dict, panel, value);
    if (!groups.has(key)) {
      const labelParts = [
        ...values.map((v, i) =>
          valueFields[i] === "measure"
            ? valueName(dict, panel.data, valueAt(panel, v))
            : displayField(dict, panel, valueFields[i], v) || "未指定",
        ),
        ...facets.map(
          (field, i) =>
            shelfName(field, dict) +
            "=" +
            (displayField(dict, panel, field, facet[i]) || "未指定"),
        ),
      ];
      const mark = value.mark ?? pivot.mark;
      const format =
        !mark || mark === "auto" ? (temporal ? "line" : "bar") : mark;
      const dimensions = new Map<ShelfAxis, string>();
      valueFields.forEach((f, i) => {
        dimensions.set(f, values[i]);
      });
      facets.forEach((f, i) => {
        dimensions.set(f, facet[i]);
      });
      groups.set(key, { labelParts, unit, marks: [], format, dimensions });
    }
    groups.get(key)!.marks.push({ category: categoryKey, value: p.value });
    categories.set(categoryKey, category.join(" › ") || "未指定");
  }
  const ordered = Array.from(categories.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const positions = new Map(ordered.map((k, i) => [k, i]));
  const jstDay = temporal && categoryFields[0] === "day";
  const time = (key: string) =>
    Date.parse(categories.get(key)! + (jstDay ? "T00:00:00+09:00" : ""));
  const first = temporal ? time(ordered[0]) : 0,
    last = temporal ? time(ordered[ordered.length - 1]) : 0;
  const bucketMs = jstDay
    ? 86400000
    : temporal
      ? Number(categoryFields[0].slice(5)) * 1000
      : 0;
  const band = temporal
    ? bucketMs / (last - first + bucketMs)
    : 1 / ordered.length;
  const formats = new Set(Array.from(groups.values(), (g) => g.format));
  const stacked = formats.has("stacked_area") || formats.has("area"),
    bars = formats.has("bar");
  const coord = (key: string) =>
    temporal && (stacked || bars)
      ? (time(key) - first + bucketMs / 2) / (last - first + bucketMs)
      : temporal && last > first
        ? (time(key) - first) / (last - first)
        : ((positions.get(key) ?? 0) + 0.5) / ordered.length;
  const all = Array.from(groups.entries());
  const legendFields = [...valueFields, ...facets];
  const varyingParts = legendFields.map((field) =>
    all.some(
      ([, group]) =>
        group.dimensions.get(field) !== all[0][1].dimensions.get(field),
    ),
  );
  const units = new Set(all.map(([, group]) => group.unit));
  // Assign each channel independently so matching field values share the same mark across series.
  const scale = (channel: StyleChannel) => {
    const field = pivot.encoding?.[channel];
    if (!field || !all.some(([, g]) => g.dimensions.has(field)))
      return undefined;
    const domain = Array.from(
      new Set(all.map(([, g]) => g.dimensions.get(field) ?? "")),
    ).sort();
    const indices = new Map(
      domain.map((v, i) => [v, panel.styleDefaults?.[channel] ?? i]),
    );
    for (const rule of pivot.styleRules ?? [])
      if (rule.channel === channel) indices.set(rule.value, rule.index);
    return (values: Map<ShelfAxis, string>) =>
      indices.get(values.get(field) ?? "") ?? 0;
  };
  const colorScale = scale("color"),
    dashScale = scale("dash"),
    widthScale = scale("width"),
    shapeScale = scale("shape");
  const styles = new Map(
    all.map(([key, g], i) => [
      key,
      {
        color:
          palette[
            (colorScale?.(g.dimensions) ??
              panel.styleDefaults?.color ??
              panel.fixedStyle?.color ??
              i) % palette.length
          ],
        dash: dashPatterns[
          (dashScale?.(g.dimensions) ??
            panel.styleDefaults?.dash ??
            panel.fixedStyle?.dash ??
            0) % 3
        ],
        width:
          lineWidths[
            (widthScale?.(g.dimensions) ??
              panel.styleDefaults?.width ??
              panel.fixedStyle?.width ??
              1) % 3
          ],
        shape:
          (shapeScale?.(g.dimensions) ??
            panel.styleDefaults?.shape ??
            panel.fixedStyle?.shape ??
            0) % 3,
      },
    ]),
  );
  const visible = all.filter(
    ([k]) => stacked || !groups.has(focused) || k === focused,
  );
  const barGroups = visible.filter(([, g]) => g.format === "bar");
  const domains = new Map<string, [number, number]>();
  const totals = new Map<string, { positive: number; negative: number }>();
  const baselines = new Map<Mark, number>();
  for (const [, g] of visible) {
    const domain = domains.get(g.unit) ?? [0, 0];
    for (const m of g.marks) {
      let edge = m.value;
      if (isStacked(g.format)) {
        const total = totals.get(m.category) ?? { positive: 0, negative: 0 };
        const sign = m.value < 0 ? "negative" : "positive";
        baselines.set(m, total[sign]);
        total[sign] += m.value;
        totals.set(m.category, total);
        edge = total[sign];
      }
      domain[0] = Math.min(domain[0], edge);
      domain[1] = Math.max(domain[1], edge);
    }
    domains.set(g.unit, domain);
  }
  const mixed = domains.size > 1;
  if (
    new Set(
      visible.filter(([, g]) => isStacked(g.format)).map(([, g]) => g.unit),
    ).size > 1
  )
    return (
      <p role="status">
        {formats.has("area") ? "エリアグラフ" : "積み上げ面"}
        には同じ単位の指標を配置してください。
      </p>
    );
  const [low, maximum] = domains.values().next().value ?? [0, 1];
  const counts = !mixed
    ? countAxis(
        panel.values.every((v) => countsWhole(dict, panel.data, v)),
        maximum,
      )
    : undefined;
  const high = counts?.maximum ?? maximum;
  const tickValues =
    counts?.ticks ??
    ticks.map((t) => (mixed ? t * 100 : low + t * (high - low || 1)));
  const xy = (c: number, v: number) =>
    horizontal ? [68 + 490 * v, 155 - 125 * c] : [68 + 490 * c, 155 - 125 * v];
  const tickKeys = ordered.filter(
    (_, i) =>
      ordered.length <= 5 ||
      ticks.some((t) => Math.round(t * (ordered.length - 1)) === i),
  );
  const formatCategory = (key: string) =>
    (JSON.parse(key) as string[])
      .map((v, i) => displayField(dict, panel, categoryFields[i], v))
      .join(" › ") || "未指定";
  const axisName = (field: ShelfAxis) =>
    isTemporalField(field) && field !== "day" && field !== "time:86400"
      ? shelfName(field, dict) + " " + fieldZone(pivot, field)
      : shelfName(field, dict);
  return (
    <div className="worksheet-plot">
      <small>
        横軸 {columns.map(axisName).join(" › ")}　縦軸{" "}
        {rows.map(axisName).join(" › ")}
        {units.size === 1 && all[0][1].unit && "　単位 " + all[0][1].unit}
        {mixed ? "　単位ごとに目盛を正規化" : ""}
      </small>
      <div className="chart-with-legend">
        <InspectablePlot
          viewBox="0 0 625 190"
          bounds={{ left: 68, right: 558, top: 30, bottom: 155 }}
          vertical={horizontal}
          samples={ordered.map((key) => ({
            key,
            position: xy(coord(key), 0)[horizontal ? 1 : 0],
          }))}
          heading={(key) =>
            formatCategory(key) +
            (temporal ? " " + fieldZone(pivot, categoryFields[0]) : "")
          }
          readings={(key) => {
            const rows = visible.map(([id, g]) => ({
              id,
              label:
                g.labelParts.filter((_, i) => varyingParts[i]).join(" · ") ||
                g.labelParts.join(" · "),
              value: g.marks.find((m) => m.category === key)?.value,
              unit: g.unit,
              color: styles.get(id)!.color,
            }));
            const total = totals.get(key);
            if (total)
              return [
                ...rows,
                {
                  id: "total",
                  label: "観測合計",
                  value: total.positive + total.negative,
                  unit: visible.find(([, g]) => isStacked(g.format))?.[1].unit,
                },
              ];
            return rows;
          }}
          label={
            formats.size > 1
              ? "複合グラフ"
              : formats.has("area")
                ? "全系列のエリアグラフ"
                : stacked
                  ? "全系列の積み上げ面グラフ"
                  : bars
                    ? "カテゴリ別の棒グラフ"
                    : "系列別の折れ線グラフ"
          }
        >
          {tickValues.map((value) => {
            const t = mixed ? value / 100 : (value - low) / (high - low || 1);
            const [x, y] = xy(0, t),
              [x2, y2] = xy(1, t);
            return (
              <g key={t}>
                <line x1={x} y1={y} x2={x2} y2={y2} stroke="#dae5e3" />
                <text
                  x={horizontal ? x : x - 5}
                  y={horizontal ? 173 : y + 3}
                  textAnchor={horizontal ? "middle" : "end"}
                >
                  {number(value)}
                  {mixed && "%"}
                </text>
              </g>
            );
          })}
          {tickKeys.map((k) => {
            const [x, y] = xy(coord(k), 0),
              label = formatCategory(k);
            return (
              <text
                key={k}
                x={horizontal ? 63 : x}
                y={horizontal ? y + 3 : 174}
                textAnchor={horizontal ? "end" : "middle"}
              >
                {label.length > (horizontal ? 10 : 17)
                  ? label.slice(0, horizontal ? 9 : 16) + "…"
                  : label}
                <title>{label}</title>
              </text>
            );
          })}
          {[...visible]
            .sort(
              ([, a], [, b]) =>
                Number(a.format === "line") - Number(b.format === "line") ||
                Number(isStacked(b.format)) - Number(isStacked(a.format)),
            )
            .map(([key, g]) => {
              const index = barGroups.findIndex(([k]) => k === key);
              const bars = g.format === "bar",
                stacked = isStacked(g.format);
              const {
                color,
                dash,
                width: strokeWidth,
                shape,
              } = styles.get(key)!;
              const [min, observedMax] = domains.get(g.unit)!;
              const max = counts?.maximum ?? observedMax;
              const scale = (v: number) => (v - min) / (max - min || 1);
              const marks = g.marks.sort(
                (a, b) => coord(a.category) - coord(b.category),
              );
              const runs: Mark[][] = [];
              if (g.format === "area") {
                for (const mark of marks) {
                  const run = runs.at(-1);
                  const prev = run?.at(-1);
                  const adjacent =
                    prev &&
                    (temporal
                      ? time(mark.category) - time(prev.category) === bucketMs
                      : positions.get(mark.category)! -
                          positions.get(prev.category)! ===
                        1);
                  if (
                    run &&
                    prev &&
                    adjacent &&
                    prev.value < 0 === mark.value < 0
                  )
                    run.push(mark);
                  else runs.push([mark]);
                }
              }
              const width =
                ((horizontal ? 125 : 490) * band * 0.78) /
                Math.max(1, barGroups.length);
              return (
                <g
                  key={key}
                  fill={color}
                  opacity={
                    stacked && groups.has(focused) && focused !== key ? 0.3 : 1
                  }
                >
                  {runs.map((run) => {
                    const edge = (m: Mark, upper: boolean) =>
                      xy(
                        coord(m.category),
                        scale(baselines.get(m)! + (upper ? m.value : 0)),
                      ).join(",");
                    const top = run.map((m) => edge(m, true)).join(" ");
                    const bottom = run
                      .map((m) => edge(m, false))
                      .reverse()
                      .join(" ");
                    return (
                      <g key={run[0].category}>
                        <polygon
                          points={top + " " + bottom}
                          fillOpacity={0.25}
                        />
                        <polyline
                          points={top}
                          fill="none"
                          stroke={color}
                          strokeWidth={strokeWidth}
                          strokeDasharray={dash}
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                  {!bars && !stacked && (
                    <path
                      fill="none"
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeDasharray={dash}
                      strokeLinecap="round"
                      d={marks
                        .map((m, i) => {
                          return (
                            (i ? "L" : "M") +
                            xy(coord(m.category), scale(m.value)).join(",")
                          );
                        })
                        .join(" ")}
                    />
                  )}
                  {marks.map((m) => {
                    const [x, y] = xy(coord(m.category), scale(m.value)),
                      [x0, y0] = xy(coord(m.category), scale(0));
                    const offset = (index - barGroups.length / 2) * width;
                    const title = (
                      <title key={m.category}>
                        {formatCategory(m.category)} ·{" "}
                        {g.labelParts.join(" · ")} · {number(m.value)} {g.unit}
                      </title>
                    );
                    if (stacked) {
                      const base = baselines.get(m) ?? 0;
                      const total = totals.get(m.category)!;
                      const observed = (
                        <title key={m.category}>
                          {formatCategory(m.category)} ·{" "}
                          {g.labelParts.join(" · ")} · {number(m.value)}{" "}
                          {g.unit} ／ 観測合計{" "}
                          {number(total.positive + total.negative)} {g.unit}
                        </title>
                      );
                      const c = coord(m.category);
                      if (g.format === "area") {
                        const [x, y] = xy(c, scale(base + m.value));
                        return (
                          <PointSymbol
                            key={m.category}
                            shape={shape}
                            x={x}
                            y={y}
                            r={marks.length > 200 ? 1 : 2.5}
                          >
                            {observed}
                          </PointSymbol>
                        );
                      }
                      const start = c - band / 2,
                        end = c + band / 2;
                      const polygon = [
                        xy(start, scale(base)),
                        xy(start, scale(base + m.value)),
                        xy(end, scale(base + m.value)),
                        xy(end, scale(base)),
                      ];
                      return (
                        <polygon
                          key={m.category}
                          points={polygon.map((p) => p.join(",")).join(" ")}
                        >
                          {observed}
                        </polygon>
                      );
                    }
                    return bars ? (
                      <rect
                        key={m.category}
                        x={horizontal ? Math.min(x, x0) : x + offset}
                        y={horizontal ? y + offset : Math.min(y, y0)}
                        width={horizontal ? Math.abs(x - x0) : width}
                        height={horizontal ? width : Math.abs(y - y0)}
                      >
                        {title}
                      </rect>
                    ) : (
                      <PointSymbol
                        shape={shape}
                        key={m.category}
                        x={x}
                        y={y}
                        r={marks.length > 200 ? 1 : 2.5}
                      >
                        {title}
                      </PointSymbol>
                    );
                  })}
                </g>
              );
            })}
        </InspectablePlot>
        <div className="legend">
          {legendAction}
          {all.length > 1 &&
            all.map(([k, g]) => {
              const style = styles.get(k)!;
              return (
                <button
                  type="button"
                  key={k}
                  style={{ borderLeftColor: style.color }}
                  aria-pressed={focused === k}
                  onClick={() => focus(focused === k ? "" : k)}
                >
                  <svg
                    className="legend-key"
                    aria-hidden="true"
                    viewBox="0 0 32 12"
                    fill={style.color}
                  >
                    {g.format === "line" || g.format === "area" ? (
                      <>
                        {g.format === "area" && (
                          <rect
                            x="1"
                            y="6"
                            width="30"
                            height="6"
                            fillOpacity={0.25}
                          />
                        )}
                        <line
                          x1="1"
                          x2="31"
                          y1="6"
                          y2="6"
                          stroke={style.color}
                          strokeWidth={style.width}
                          strokeDasharray={style.dash}
                          strokeLinecap="round"
                        />
                        <PointSymbol shape={style.shape} x={16} y={6} r={3} />
                      </>
                    ) : (
                      <rect x="3" y="2" width="26" height="8" />
                    )}
                  </svg>
                  {g.labelParts.filter((_, i) => varyingParts[i]).join(" · ")}
                  {units.size > 1 && g.unit && " (" + g.unit + ")"}
                  {mixed &&
                    domains.has(g.unit) &&
                    " " + domains.get(g.unit)!.map(number).join("–")}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
