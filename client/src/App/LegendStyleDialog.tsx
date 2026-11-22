import { useEffect, useRef, useState } from "react";
import {
  type Panel,
  type Point,
  type ShelfAxis,
  type StyleChannel,
  shelfFields,
  shelfName,
} from "../../../shared/console";
import {
  dashPatterns,
  lineWidths,
  PointSymbol,
  palette,
  styleNames,
} from "./SeriesStyle";

export function LegendStyleDialog({
  panel,
  points,
  channels,
  encoding,
  save,
  close,
}: {
  panel: Panel;
  points: Point[];
  channels: [StyleChannel, string][];
  encoding: Partial<Record<StyleChannel, ShelfAxis>>;
  save: (
    channel: StyleChannel,
    value: string | undefined,
    index: number | undefined,
  ) => void;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, select] = useState(channels[0][0]);
  const channel = channels.some(([ch]) => ch === selected)
    ? selected
    : channels[0][0];
  const [search, find] = useState("");
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const field = encoding[channel];
  const rules = new Map(
    panel.pivot?.styleRules
      ?.filter((r) => r.channel === channel)
      .map((r) => [r.value, r.index]),
  );
  const values = new Set(rules.keys());
  if (field) {
    const pivot = panel.pivot;
    if (pivot) {
      for (const role of ["row", "column", "series"] as const) {
        const i = shelfFields(pivot[role]).indexOf(field);
        if (i < 0) continue;
        for (const p of points) {
          const parts =
            role === "row"
              ? (p.rowPath ?? [p.series])
              : role === "column"
                ? (p.columnPath ?? [p.column ?? ""])
                : (p.facetPath ?? [p.facet ?? ""]);
          values.add(parts[i] ?? "");
        }
      }
    } else for (const p of points) values.add(p.series);
  }
  const defaultIndex =
    panel.styleDefaults?.[channel] ??
    (!panel.pivot?.encoding?.[channel]
      ? panel.fixedStyle?.[channel]
      : undefined);
  function entry(value: string | undefined, index: number | undefined) {
    const label = value === undefined ? "全項目" : value || "（空の値）";
    const sample = index ?? defaultIndex;
    return (
      <label
        key={value === undefined ? "default" : "value:" + value}
        className="legend-style-entry"
      >
        <svg
          className="style-sample"
          width="26"
          height="14"
          viewBox="0 0 26 14"
          aria-hidden="true"
        >
          {sample !== undefined &&
            (channel === "color" ? (
              <rect
                x="2"
                y="2"
                width="21"
                height="10"
                rx="2"
                fill={palette[sample]}
              />
            ) : channel === "shape" ? (
              <g fill="currentColor">
                <PointSymbol shape={sample} x={13} y={7} r={4} />
              </g>
            ) : (
              <line
                x1="2"
                x2="24"
                y1="7"
                y2="7"
                stroke="currentColor"
                strokeWidth={channel === "width" ? lineWidths[sample] : 2}
                strokeDasharray={
                  channel === "dash" ? dashPatterns[sample] : undefined
                }
                strokeLinecap="round"
              />
            ))}
        </svg>
        <span>{label}</span>
        <select
          aria-label={
            value === undefined ? "全項目の割り当て" : label + " の個別指定"
          }
          disabled={
            value !== undefined &&
            index === undefined &&
            (panel.pivot?.styleRules?.length ?? 0) >= 256
          }
          value={index ?? ""}
          onChange={(e) =>
            save(
              channel,
              value,
              e.target.value === "" ? undefined : Number(e.target.value),
            )
          }
        >
          <option value="">
            {value === undefined ? "自動" : "全項目に従う"}
          </option>
          {styleNames[channel].map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <dialog
      ref={ref}
      className="shelf-picker legend-style-dialog"
      aria-label="凡例のスタイルを編集"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="options-heading">
        <h3>凡例のスタイルを編集</h3>
        <button type="button" onClick={close}>
          閉じる
        </button>
      </div>
      <div className="style-channels">
        {channels.map(([ch, label]) => (
          <button
            key={ch}
            type="button"
            aria-pressed={ch === channel}
            onClick={() => {
              select(ch);
              find("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {entry(undefined, defaultIndex)}
      {field && values.size > 0 && (
        <fieldset>
          <legend>{shelfName(field)}</legend>
          {values.size > 8 && (
            <input
              type="search"
              placeholder="属性値を検索"
              aria-label="属性値を検索"
              value={search}
              onChange={(e) => find(e.target.value)}
            />
          )}
          <div className="style-value-list">
            {[...values]
              .sort()
              .filter((v) => v.toLowerCase().includes(search.toLowerCase()))
              .map((v) => entry(v, rules.get(v)))}
          </div>
        </fieldset>
      )}
    </dialog>
  );
}
