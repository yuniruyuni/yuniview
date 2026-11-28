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

/**
 * A monitor's threshold across a chart. With `change`, it can be dragged up
 * and down; the value moves only here until the pointer is released, so the
 * chart's scale holds still under the pointer.
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
}) {
  const [draft, setDraft] = useState<number>();
  const shown = draft ?? value;
  const y = toY(shown);
  function at(e: React.PointerEvent<SVGLineElement>) {
    const matrix = e.currentTarget.ownerSVGElement?.getScreenCTM()?.inverse();
    if (!matrix) return value;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    return round(
      fromY(Math.max(top, Math.min(bottom, p.y))),
      fromY(top) - fromY(bottom),
      whole,
    );
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
            setDraft(value);
          }}
          onPointerMove={(e) => {
            if (draft === undefined) return;
            e.stopPropagation();
            setDraft(at(e));
          }}
          onPointerUp={(e) => {
            if (draft === undefined) return;
            e.stopPropagation();
            const next = at(e);
            setDraft(undefined);
            if (next !== value) change(next);
          }}
          onPointerCancel={() => setDraft(undefined)}
        >
          <title>ドラッグして閾値を変更（{number(shown)}）</title>
        </line>
      )}
    </g>
  );
}
