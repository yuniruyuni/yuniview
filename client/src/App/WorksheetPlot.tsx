import { useState } from "react";
import {
  isTimeField,
  measures,
  metricName,
  type Panel,
  type Point,
  shelfFields,
  shelfName,
} from "../../../shared/console";
import { number } from "../api";

const palette = [
  "#007f84",
  "#ac541e",
  "#7461a8",
  "#357aa8",
  "#a34e75",
  "#687e29",
  "#33475c",
];
const ticks = [0, 0.25, 0.5, 0.75, 1];
export function WorksheetPlot({
  panel,
  points,
}: {
  panel: Panel;
  points: Point[];
}) {
  const [focused, focus] = useState("");
  const pivot = panel.pivot!;
  const rows = shelfFields(pivot.row),
    columns = shelfFields(pivot.column),
    facets = shelfFields(pivot.series);
  const horizontal = columns.includes("measure");
  const valueFields = horizontal ? columns : rows,
    categoryFields = horizontal ? rows : columns;
  const temporal =
    categoryFields.length === 1 && isTimeField(categoryFields[0]);
  const stacked = pivot.mark === "stacked_area";
  const bars =
    pivot.mark === "bar" || (!temporal && pivot.mark !== "line" && !stacked);
  type Mark = { category: string; value: number };
  const groups = new Map<
    string,
    { label: string; unit: string; marks: Mark[] }
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
    const unit = panel.unit ?? p.metricUnit ?? "";
    if (!groups.has(key)) {
      const label = [
        ...values.map((v, i) =>
          valueFields[i] === "measure"
            ? panel.measure === "metric"
              ? metricName(v)
              : measures[panel.measure]
            : v || "未指定",
        ),
        ...facets.map(
          (field, i) => shelfName(field) + "=" + (facet[i] || "未指定"),
        ),
      ].join(" · ");
      groups.set(key, { label, unit, marks: [] });
    }
    groups.get(key)!.marks.push({ category: categoryKey, value: p.value });
    categories.set(categoryKey, category.join(" › ") || "未指定");
  }
  const ordered = Array.from(categories.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  const positions = new Map(ordered.map((k, i) => [k, i]));
  const time = (key: string) => Date.parse(categories.get(key)!);
  const first = temporal ? time(ordered[0]) : 0,
    last = temporal ? time(ordered[ordered.length - 1]) : 0;
  const bucketMs = temporal ? Number(categoryFields[0].slice(5)) * 1000 : 0;
  const band = temporal
    ? bucketMs / (last - first + bucketMs)
    : 1 / ordered.length;
  const coord = (key: string) =>
    temporal && (stacked || bars)
      ? (time(key) - first + bucketMs / 2) / (last - first + bucketMs)
      : temporal && last > first
        ? (time(key) - first) / (last - first)
        : ((positions.get(key) ?? 0) + 0.5) / ordered.length;
  const all = Array.from(groups.entries());
  const visible = all.filter(
    ([k]) => stacked || !groups.has(focused) || k === focused,
  );
  const domains = new Map<string, [number, number]>();
  const totals = new Map<string, { positive: number; negative: number }>();
  const baselines = new Map<Mark, number>();
  for (const [, g] of visible) {
    const domain = domains.get(g.unit) ?? [0, 0];
    for (const m of g.marks) {
      let edge = m.value;
      if (stacked) {
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
  if (stacked && mixed)
    return (
      <p role="status">積み上げ面には同じ単位の指標を配置してください。</p>
    );
  const [low, high] = domains.values().next().value ?? [0, 1];
  const xy = (c: number, v: number) =>
    horizontal ? [68 + 490 * v, 155 - 125 * c] : [68 + 490 * c, 155 - 125 * v];
  const tickKeys = ordered.filter(
    (_, i) =>
      ordered.length <= 5 ||
      ticks.some((t) => Math.round(t * (ordered.length - 1)) === i),
  );
  const formatCategory = (k: string) =>
    temporal
      ? new Date(time(k)).toLocaleString("ja-JP", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : categories.get(k)!;
  return (
    <div className="worksheet-plot">
      <small>
        横軸 {columns.map(shelfName).join(" › ")}　縦軸{" "}
        {rows.map(shelfName).join(" › ")}
        {mixed ? "　単位ごとに目盛を正規化" : ""}
      </small>
      <svg
        viewBox="0 0 625 190"
        role="img"
        aria-label={
          stacked
            ? "全系列の積み上げ面グラフ"
            : bars
              ? "カテゴリ別の棒グラフ"
              : "系列別の折れ線グラフ"
        }
      >
        {ticks.map((t) => {
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
                {mixed
                  ? number(t * 100) + "%"
                  : number(low + t * (high - low || 1))}
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
        {visible.map(([key, g], index) => {
          const color =
            palette[all.findIndex(([k]) => k === key) % palette.length];
          const [min, max] = domains.get(g.unit)!;
          const scale = (v: number) => (v - min) / (max - min || 1);
          const marks = g.marks.sort(
            (a, b) => coord(a.category) - coord(b.category),
          );
          const width =
            ((horizontal ? 125 : 490) * band * 0.78) / visible.length;
          return (
            <g
              key={key}
              fill={color}
              opacity={
                stacked && groups.has(focused) && focused !== key ? 0.3 : 1
              }
            >
              {!bars && !stacked && (
                <path
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
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
                const offset = (index - visible.length / 2) * width;
                const title = (
                  <title key={m.category}>
                    {formatCategory(m.category)} · {g.label} · {number(m.value)}{" "}
                    {g.unit}
                  </title>
                );
                if (stacked) {
                  const base = baselines.get(m) ?? 0;
                  const total = totals.get(m.category)!;
                  const c = coord(m.category);
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
                      <title>
                        {formatCategory(m.category)} · {g.label} ·{" "}
                        {number(m.value)} {g.unit} ／ 観測合計{" "}
                        {number(total.positive + total.negative)} {g.unit}
                      </title>
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
                  <circle
                    key={m.category}
                    cx={x}
                    cy={y}
                    r={marks.length > 200 ? 1 : 2.5}
                  >
                    {title}
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {all.map(([k, g], i) => (
          <button
            type="button"
            key={k}
            style={{ borderLeftColor: palette[i % palette.length] }}
            aria-pressed={focused === k}
            onClick={() => focus(focused === k ? "" : k)}
          >
            {g.label}
            {g.unit && " (" + g.unit + ")"}
            {mixed &&
              domains.has(g.unit) &&
              " " + domains.get(g.unit)!.map(number).join("–")}
          </button>
        ))}
      </div>
    </div>
  );
}
