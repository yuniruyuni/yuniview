import { type ReactNode, useId, useState } from "react";

type Sample = { key: string; position: number };
type Reading = {
  id: string;
  label: string;
  value?: number;
  unit?: string;
  color?: string;
};
const numeric = new Intl.NumberFormat("ja-JP", {
  maximumSignificantDigits: 12,
});

export function InspectablePlot({
  viewBox,
  label,
  bounds,
  vertical = false,
  samples,
  heading,
  readings,
  children,
}: {
  viewBox: string;
  label: string;
  bounds: { left: number; right: number; top: number; bottom: number };
  vertical?: boolean;
  samples: Sample[];
  heading: (key: string) => string;
  readings: (key: string) => Reading[];
  children: ReactNode;
}) {
  const [key, select] = useState<string>();
  const tipId = useId();
  const index =
    key === undefined ? -1 : samples.findIndex((s) => s.key === key);
  const selected = samples[index];
  const { left, right, top, bottom } = bounds;
  function inspect(e: React.PointerEvent<SVGSVGElement>) {
    const transform = e.currentTarget.getScreenCTM();
    if (!transform || !samples.length) return;
    const { x, y } = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      transform.inverse(),
    );
    if (x < left || x > right || y < top || y > bottom) {
      select(undefined);
      return;
    }
    const target = vertical ? -y : x;
    const position = (i: number) =>
      vertical ? -samples[i].position : samples[i].position;
    let lo = 0,
      hi = samples.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (position(mid) < target) lo = mid + 1;
      else hi = mid;
    }
    const nearest =
      lo > 0 && target - position(lo - 1) <= position(lo) - target
        ? lo - 1
        : lo;
    select(samples[nearest].key);
  }
  return (
    <section
      aria-label={label + "の値を確認"}
      className="inspectable-plot"
      onPointerLeave={() => select(undefined)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) select(undefined);
      }}
    >
      <svg
        viewBox={viewBox}
        role="img"
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Arrow keys inspect individual samples on the focused plot.
        tabIndex={0}
        aria-describedby={selected ? tipId : undefined}
        onPointerMove={inspect}
        onPointerDown={inspect}
        onPointerCancel={() => select(undefined)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            select(undefined);
            return;
          }
          const previous = vertical ? "ArrowDown" : "ArrowLeft";
          const next = vertical ? "ArrowUp" : "ArrowRight";
          if ((e.key !== previous && e.key !== next) || !samples.length) return;
          e.preventDefault();
          const i =
            index < 0
              ? e.key === next
                ? 0
                : samples.length - 1
              : index + (e.key === next ? 1 : -1);
          select(samples[Math.max(0, Math.min(samples.length - 1, i))].key);
        }}
      >
        {children}
        {selected && (
          <line
            className="plot-cursor"
            x1={vertical ? left : selected.position}
            x2={vertical ? right : selected.position}
            y1={vertical ? selected.position : top}
            y2={vertical ? selected.position : bottom}
          />
        )}
      </svg>
      {selected && (
        <div
          id={tipId}
          role="tooltip"
          className="plot-readings"
          data-right={
            (!vertical && selected.position < (left + right) / 2) || undefined
          }
          data-bottom={
            (vertical && selected.position < (top + bottom) / 2) || undefined
          }
        >
          <strong>{heading(selected.key)}</strong>
          <dl>
            {readings(selected.key).map((r) => (
              <div key={r.id}>
                <dt>
                  {r.color && <i style={{ background: r.color }} />}
                  {r.label}
                </dt>
                <dd>
                  {r.value === undefined
                    ? "未観測"
                    : [numeric.format(r.value), r.unit]
                        .filter(Boolean)
                        .join(" ")}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
