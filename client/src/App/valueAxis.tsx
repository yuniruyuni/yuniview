import { useRef, useState } from "react";
import type { Panel } from "../../../shared/console";
import { number } from "../api";
import { countAxis } from "./countAxis";

export type Bounds = NonNullable<Panel["yAxis"]>;

/**
 * The ends and ticks of a value axis. Ends the panel fixes are kept;
 * the others follow the values, rounded for counts as before.
 */
export function valueAxis(
  whole: boolean,
  low: number,
  maximum: number,
  fixed?: Bounds,
  /** Where ticks go between the ends, when they aren't counts. */
  fractions = [0, 0.5, 1],
) {
  const fixes = fixed?.min !== undefined || fixed?.max !== undefined;
  const counts = fixes ? undefined : countAxis(whole, maximum);
  if (counts) return { low, high: counts.maximum, ticks: counts.ticks };
  const bottom = fixed?.min ?? low;
  const top = fixed?.max ?? maximum;
  const high = top > bottom ? top : bottom + 1;
  return {
    low: bottom,
    high,
    ticks: (fixes ? [0, 0.25, 0.5, 0.75, 1] : fractions).map(
      (t) => bottom + t * (high - bottom),
    ),
  };
}

/**
 * The bounds with one end set, or left to the values when `value` is
 * undefined; null when the ends would cross.
 */
export function withBound(
  bounds: Bounds | undefined,
  end: keyof Bounds,
  value: number | undefined,
): Bounds | undefined | null {
  const next: Bounds = { ...bounds };
  if (value === undefined) delete next[end];
  else next[end] = value;
  if (next.min !== undefined && next.max !== undefined && next.min >= next.max)
    return null;
  return next.min === undefined && next.max === undefined ? undefined : next;
}

/**
 * An end of the value axis as its tick label. Clicking it lets the end be
 * typed in, or left to the values with 自動.
 */
export function AxisBound({
  x,
  y,
  value,
  end,
  fixed,
  commit,
}: {
  /** Where the label ends, beside the axis. */
  x: number;
  y: number;
  value: number;
  end: keyof Bounds;
  fixed: boolean;
  commit: (value: number | undefined) => void;
}) {
  const [editing, edit] = useState(false);
  const cancelled = useRef(false);
  const name = end === "max" ? "上端" : "下端";
  if (editing)
    return (
      <foreignObject x={Math.max(0, x - 60)} y={y - 15} width={170} height={28}>
        <div
          className="axis-bound-editor"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
        >
          <input
            type="number"
            step="any"
            aria-label={`縦軸の${name}`}
            defaultValue={fixed ? value : ""}
            placeholder={number(value)}
            // biome-ignore lint/a11y/noAutofocus: The field opens because its label was just clicked.
            autoFocus
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") cancelled.current = true;
              if (e.key === "Enter" || e.key === "Escape")
                e.currentTarget.blur();
            }}
            onBlur={(e) => {
              edit(false);
              if (cancelled.current) return;
              const text = e.currentTarget.value.trim();
              const n = Number(text);
              if (text === "") commit(undefined);
              else if (Number.isFinite(n)) commit(n);
            }}
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              cancelled.current = true;
              edit(false);
              commit(undefined);
            }}
          >
            自動
          </button>
        </div>
      </foreignObject>
    );
  // The title is the label's sibling, so the label reads as its number.
  return (
    <>
      <title>
        クリックして縦軸の{name}を設定（いまは{fixed ? "固定" : "自動"}）
      </title>
      {/* biome-ignore lint/a11y/useSemanticElements: An SVG label can't be a button element. */}
      <text
        x={x}
        y={y}
        textAnchor="end"
        className={fixed ? "axis-bound fixed" : "axis-bound"}
        role="button"
        tabIndex={0}
        aria-label={`縦軸の${name} ${number(value)}${fixed ? "（固定）" : "（自動）"}を変更`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          cancelled.current = false;
          edit(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = false;
          edit(true);
        }}
      >
        {number(value)}
      </text>
    </>
  );
}
