import { useState } from "react";
import { measures, type Panel } from "../../../shared/console";
import { useDropPreview } from "./useDropPreview";

const displays = {
  chart: "折れ線",
  table: "表",
  value: "数値",
  pivot: "ピボット表",
};
export function PanelLayout({
  panels,
  index,
  select,
  initial,
  apply,
}: {
  panels: Panel[];
  index: number;
  select: (index: number) => void;
  initial: Panel;
  apply: (panels: Panel[], index: number) => void;
}) {
  const [notice, say] = useState("");
  function placed(from: number, to: number) {
    const next = [...panels];
    const item = from === -1 ? initial : next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
  }
  function move(from: number, to: number) {
    if (
      to < 0 ||
      to >= panels.length + (from === -1 ? 1 : 0) ||
      (from === -1 && panels.length >= 24)
    )
      return;
    const next = placed(from, to);
    if (from === -1) next[to] = { ...initial, id: crypto.randomUUID() };
    apply(next, to);
    say(`${next[to].title}を ${to + 1} 番目に配置しました`);
  }
  const drag = useDropPreview<number>((from, target) =>
    move(from, Number(target)),
  );
  const to = drag.preview?.target == null ? null : Number(drag.preview.target);
  const projected =
    drag.preview && to !== null ? placed(drag.preview.item, to) : panels;
  return (
    <div {...drag.bind} className="layout-editor">
      {drag.preview && (
        <span className="drag-ghost" aria-hidden="true">
          {drag.preview.item === -1
            ? "新しいパネル"
            : panels[drag.preview.item].title}
        </span>
      )}
      <div className="layout-head">
        <h4>パネル配置</h4>
        <button
          type="button"
          className="drag-source"
          disabled={panels.length >= 24}
          onPointerDown={(e) => drag.start(e, -1)}
          onClick={() => move(-1, panels.length)}
        >
          ＋ パネル追加
        </button>
      </div>
      <p className="layout-help">
        パネルをドラッグして並べ替えます。「＋
        パネル追加」も置きたい位置にドラッグできます。キーボードでは
        Alt＋矢印で移動します。
      </p>
      <div className="layout-grid">
        {projected.map((p, i) => (
          <div
            key={p.id ?? "incoming-panel"}
            data-drop={i}
            className="layout-cell"
            data-preview={to === i || undefined}
          >
            <button
              type="button"
              className="layout-tile drag-source"
              aria-pressed={drag.preview ? to === i : index === i}
              onPointerDown={(e) => drag.start(e, i)}
              onClick={() => select(i)}
              onKeyDown={(e) => {
                const offset = ["ArrowLeft", "ArrowUp"].includes(e.key)
                  ? -1
                  : ["ArrowRight", "ArrowDown"].includes(e.key)
                    ? 1
                    : 0;
                if (offset && e.altKey) {
                  e.preventDefault();
                  const dest = i + offset;
                  if (dest >= 0 && dest < panels.length) {
                    move(i, dest);
                  }
                }
              }}
              title="ドラッグまたは Alt＋矢印で移動"
            >
              <span className="tile-grip" aria-hidden="true">
                ⠿
              </span>
              <span>
                <strong>{p.title || "無題"}</strong>
                <small>
                  {displays[p.display]} · {measures[p.measure]}
                </small>
              </span>
            </button>
          </div>
        ))}
        {drag.preview?.item === -1 && projected.length === panels.length && (
          <div className="layout-end" data-drop={panels.length}>
            末尾に追加
          </div>
        )}
      </div>
      <span className="sr-only" role="status">
        {notice}
      </span>
    </div>
  );
}
