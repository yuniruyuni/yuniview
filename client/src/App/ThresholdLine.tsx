import { useState } from "react";
import { number } from "../api";

/** A step that keeps two significant digits of the axis's span. */
function round(value: number, span: number, whole: boolean) {
  const step = Math.max(
    whole ? 1 : 0,
    10 ** (Math.floor(Math.log10(Math.abs(span) || 1)) - 2),
  );
  return Number((Math.round(value / step) * step).toPrecision(12));
}

/** How far past the top of the axis, in plot units, doubles the value. */
const doubling = 40;

/**
 * A monitor's threshold across a chart. With `change`, it can be dragged up
 * and down. While dragging, the pointer reads values on the axis as it was
 * when the drag began, so the chart's scale holds still under it; above the
 * top the value keeps growing, doubling every {@link doubling} units, and
 * `drag` lets the chart widen its axis to show it.
 */
export function ThresholdLine({
  value,
  top,
  bottom,
  left,
  right,
  toY,
  fromY,
  whole,
  change,
  drag,
}: {
  value: number;
  /** Where the value axis ends and starts, in plot units. */
  top: number;
  bottom: number;
  /** Where the line starts and ends across the plot. */
  left: number;
  right: number;
  toY: (value: number) => number;
  fromY: (y: number) => number;
  /** Whether the values count things, so the threshold stays whole. */
  whole: boolean;
  change?: (value: number) => void;
  /** The value being dragged to, or undefined when the drag ends. */
  drag?: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<number>();
  /** The axis's values at its top and bottom when the drag began. */
  const [axis, holdAxis] = useState<{ top: number; bottom: number }>();
  const shown = draft ?? value;
  const y = toY(shown);
  function move(next: number | undefined) {
    setDraft(next);
    drag?.(next);
  }
  function at(e: React.PointerEvent<SVGLineElement>) {
    const matrix = e.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    if (!matrix || !axis) return value;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    const span = axis.top - axis.bottom;
    const past = top - p.y;
    const raw =
      past <= 0
        ? axis.bottom +
          (span * (bottom - Math.min(bottom, p.y))) / (bottom - top)
        : axis.top > 0
          ? axis.top * 2 ** (past / doubling)
          : axis.top + (span * past) / (bottom - top);
    return round(raw, Math.max(span, raw - axis.bottom), whole);
  }
  return (
    <g>
      <line
        className="threshold"
        x1={left}
        x2={right}
        y1={y}
        y2={y}
        stroke="#d97706"
        strokeWidth={1.25}
        strokeDasharray="5 4"
      >
        <title>閾値 {number(shown)}</title>
      </line>
      {draft !== undefined && (
        <text
          className="threshold-value"
          x={right - 4}
          y={y - 4}
          textAnchor="end"
        >
          閾値 {number(draft)}
        </text>
      )}
      {change && (
        <line
          className="threshold-handle"
          x1={left}
          x2={right}
          y1={y}
          y2={y}
          stroke="transparent"
          strokeWidth={12}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            holdAxis({ top: fromY(top), bottom: fromY(bottom) });
            move(value);
          }}
          onPointerMove={(e) => {
            if (draft === undefined) return;
            e.stopPropagation();
            move(at(e));
          }}
          onPointerUp={(e) => {
            if (draft === undefined) return;
            e.stopPropagation();
            const next = at(e);
            move(undefined);
            holdAxis(undefined);
            if (next !== value) change(next);
          }}
          onPointerCancel={() => {
            move(undefined);
            holdAxis(undefined);
          }}
        >
          <title>ドラッグして閾値を変更（{number(shown)}）</title>
        </line>
      )}
    </g>
  );
}
