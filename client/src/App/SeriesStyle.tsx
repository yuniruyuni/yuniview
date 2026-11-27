import type { StyleChannel } from "../../../shared/console";
export const palette = [
  "#0284c7",
  "#ea580c",
  "#7e22ce",
  "#428455",
  "#db2777",
  "#b45309",
  "#334155",
];
export const dashPatterns = [undefined, "1 4", "7 4"];
export const lineWidths = [1, 1.75, 3.5];
export function PointSymbol({
  shape,
  x,
  y,
  r,
  children,
}: {
  shape: number;
  x: number;
  y: number;
  r: number;
  children?: React.ReactNode;
}) {
  if (shape === 1)
    return (
      <rect x={x - r} y={y - r} width={r * 2} height={r * 2}>
        {children}
      </rect>
    );
  if (shape === 2)
    return (
      <polygon
        points={[
          [x, y - r * 1.3],
          [x + r * 1.2, y + r],
          [x - r * 1.2, y + r],
        ]
          .map((pair) => pair.join(","))
          .join(" ")}
      >
        {children}
      </polygon>
    );
  return (
    <circle cx={x} cy={y} r={r}>
      {children}
    </circle>
  );
}
export const styleNames: Record<StyleChannel, string[]> = {
  color: ["水色", "橙", "紫", "緑", "桃", "黄土", "灰"],
  dash: ["実線", "点線", "破線"],
  width: ["細い", "通常", "太い"],
  shape: ["丸", "四角", "三角"],
};
