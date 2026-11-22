import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// Keep the committed model intact until release. Both the preview and the commit
// use the same destination, resolved from the visible drop zones.
export function useDropPreview<T>(commit: (item: T, target: string) => void) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    item: T;
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const [preview, show] = useState<{ item: T; target: string | null } | null>(
    null,
  );
  const suppressClick = useRef(false);
  const cancel = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    if (current && root.current?.hasPointerCapture(current.pointer))
      root.current.releasePointerCapture(current.pointer);
    show(null);
  }, []);
  useEffect(() => {
    function cancelOnEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && gesture.current) {
        e.preventDefault();
        cancel();
      }
    }
    window.addEventListener("keydown", cancelOnEscape);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", cancelOnEscape);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);
  const target = useCallback((x: number, y: number) => {
    const el = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop]");
    return el && root.current?.contains(el) ? (el.dataset.drop ?? null) : null;
  }, []);
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame: number;
    const tick = () => {
      const g = gesture.current;
      if (!g) return;
      const overTray = document
        .elementFromPoint(g.x, g.y)
        ?.closest(".field-drop-tray");
      const edge = 48;
      const speed =
        g.y < edge
          ? -Math.min(14, (edge - g.y) / 3)
          : Math.min(14, Math.max(0, (g.y - innerHeight + edge) / 3));
      if (speed && !overTray) {
        const before = window.scrollY;
        window.scrollBy(0, speed);
        if (window.scrollY !== before)
          show({ item: g.item, target: target(g.x, g.y) });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragging, target]);
  function start(e: ReactPointerEvent, item: T) {
    if (!e.isPrimary || e.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    gesture.current = {
      item,
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  return {
    preview,
    start,
    bind: {
      ref: root,
      onPointerDownCapture() {
        suppressClick.current = false;
      },
      onPointerMove(e: ReactPointerEvent) {
        const g = gesture.current;
        if (!g || e.pointerId !== g.pointer) return;
        if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5)
          return;
        if (!g.moved) {
          g.moved = true;
          suppressClick.current = true;
          root.current?.setPointerCapture(e.pointerId);
        }
        g.x = e.clientX;
        g.y = e.clientY;
        root.current?.style.setProperty("--drag-x", `${g.x}px`);
        root.current?.style.setProperty("--drag-y", `${g.y}px`);
        const dest = target(g.x, g.y);
        show((prev) =>
          prev?.target === dest && prev.item === g.item
            ? prev
            : { item: g.item, target: dest },
        );
      },
      onPointerUp(e: ReactPointerEvent) {
        const g = gesture.current;
        if (!g || e.pointerId !== g.pointer) return;
        const dest = target(e.clientX, e.clientY);
        cancel();
        if (g.moved && dest !== null) commit(g.item, dest);
      },
      onPointerCancel: cancel,
      onClickCapture(e: React.MouseEvent) {
        if (suppressClick.current && e.detail !== 0) {
          suppressClick.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      },
    },
  };
}
