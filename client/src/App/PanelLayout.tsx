import { type ReactNode, useState } from "react";
import type { Panel } from "../../../shared/console";
import { PanelView } from "./Panels";
import { useDropPreview } from "./useDropPreview";

type Editing = {
  initial: Panel;
  apply: (panels: Panel[], configure?: Panel) => void;
  configure: (i: number) => void;
};
export function PanelLayout({
  panels,
  end,
  editing,
  toolbar,
  viewActions,
  open,
}: {
  panels: Panel[];
  end: string;
  editing?: Editing;
  toolbar: ReactNode;
  viewActions: (p: Panel, i: number) => ReactNode;
  open: (i: number) => void;
}) {
  const [notice, say] = useState("");
  function placed(from: number, to: number, initial: Panel) {
    const next = [...panels];
    const item = from === -1 ? initial : next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return next;
  }
  function move(from: number, to: number, configure = false) {
    if (
      !Number.isInteger(to) ||
      !editing ||
      to < 0 ||
      to >= panels.length + (from === -1 ? 1 : 0) ||
      (from === -1 && panels.length >= 24)
    )
      return;
    const next = placed(from, to, editing.initial);
    if (from === -1) next[to] = { ...editing.initial, id: crypto.randomUUID() };
    editing.apply(next, configure ? next[to] : undefined);
    say(`${next[to].title}を ${to + 1} 番目に配置しました`);
  }
  const drag = useDropPreview<number>(
    (from, target) => move(from, Number(target)),
    true,
  );
  const target = Number(drag.preview?.target);
  const to =
    drag.preview?.target == null || !Number.isInteger(target) ? null : target;
  const projected =
    editing && drag.preview && to !== null
      ? placed(drag.preview.item, to, editing.initial)
      : panels;
  return (
    <div {...drag.bind} className="dashboard-canvas">
      <div className="canvas-toolbar">
        {toolbar}
        {editing && (
          <button
            type="button"
            className="drag-source"
            disabled={panels.length >= 24}
            onPointerDown={(e) => drag.start(e, -1)}
            onClick={() => move(-1, panels.length, true)}
          >
            ＋ パネル追加
          </button>
        )}
      </div>
      {editing && drag.preview && (
        <span className="drag-ghost" aria-hidden="true">
          {drag.preview.item === -1
            ? "新しいパネル"
            : panels[drag.preview.item].title}
        </span>
      )}
      <div className="canvas-body">
        <div className="cards canvas-grid">
          {projected.map((p, i) => (
            <div
              className="canvas-cell"
              key={p.id ?? i}
              data-wide={p.wide || undefined}
              data-drop={editing ? i : undefined}
              data-preview={(editing && to === i) || undefined}
            >
              <PanelView
                panel={p}
                end={end}
                onEdit={!editing ? () => open(i) : undefined}
                heading={
                  editing && (
                    <button
                      type="button"
                      className="panel-handle drag-source"
                      aria-label={`${p.title} を移動`}
                      title="ドラッグまたは Alt＋矢印で移動"
                      onPointerDown={(e) => drag.start(e, i)}
                      onKeyDown={(e) => {
                        if (!e.altKey) return;
                        const offset = ["ArrowLeft", "ArrowUp"].includes(e.key)
                          ? -1
                          : ["ArrowRight", "ArrowDown"].includes(e.key)
                            ? 1
                            : 0;
                        if (offset) {
                          e.preventDefault();
                          move(i, i + offset);
                        }
                      }}
                    >
                      <span aria-hidden="true">⠿</span>{" "}
                      <span className="handle-text">{p.title || "無題"}</span>
                    </button>
                  )
                }
                actions={
                  editing ? (
                    <div className="tools">
                      <button
                        type="button"
                        aria-label={`${p.title} の設定`}
                        onClick={() => editing.configure(i)}
                      >
                        設定
                      </button>
                      <button
                        type="button"
                        aria-pressed={!!p.wide}
                        onClick={() =>
                          editing.apply(
                            panels.map((v, n) =>
                              n === i ? { ...v, wide: !p.wide } : v,
                            ),
                          )
                        }
                      >
                        全幅
                      </button>
                    </div>
                  ) : (
                    viewActions(p, i)
                  )
                }
              />
            </div>
          ))}
          {editing &&
            drag.preview?.item === -1 &&
            projected.length === panels.length && (
              <div className="layout-end" data-drop={panels.length}>
                末尾に追加
              </div>
            )}
        </div>
      </div>
      <span className="sr-only" role="status">
        {notice}
      </span>
    </div>
  );
}
