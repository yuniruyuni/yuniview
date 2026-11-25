import type { StyleChannel } from "../../../shared/console";
export const palette = [
  "#007f84",
  "#ac541e",
  "#7461a8",
  "#357aa8",
  "#a34e75",
  "#687e29",
  "#33475c",
];
export const dashPatterns = [undefined, "1 4", "7 4"];
export const lineWidths = [1, 2, 3.5];
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
  color: ["青緑", "橙", "紫", "青", "赤紫", "緑", "紺"],
  dash: ["実線", "点線", "破線"],
  width: ["細い", "通常", "太い"],
  shape: ["丸", "四角", "三角"],
};
