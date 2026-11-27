import { useEffect, useState } from "react";
import {
  blankPanel,
  type Dashboard,
  homeDashboardId,
  type Overview,
  type Panel,
  withConditions,
} from "../../../shared/console";
import { Feedback, rpc, useQuery } from "../api";
import { ConditionBar } from "./ConditionBar";
import { PanelBuilder } from "./PanelBuilder";
import { PanelLayout } from "./PanelLayout";
import { investigatePanel, Select } from "./Panels";
import { homeTemplate } from "./templates";

type Saved = { definition: Dashboard; version: string | null };
type Draft = {
  board: Dashboard;
  version: string | null;
  index: number;
  session?: { original: Panel | null; direct: boolean };
};
export function DashboardWorkspace({
  timeControl,
  end,
  meta,
  seed,
  incoming,
  consumed,
  monitor,
}: {
  timeControl: React.ReactNode;
  end: string;
  meta: Overview;
  seed: Panel;
  incoming: Panel | null;
  consumed: () => void;
  monitor: (p: Panel) => void;
}) {
  const [selected, select] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("dashboard") ?? "",
  );
  const [draft, edit] = useState<Draft | null>(
    () => history.state?.worksheetDraft ?? null,
  );
  const [route, setRoute] = useState(
    () => new URLSearchParams(location.hash.slice(1)),
  );
  const sheet = route.get("sheet");
  const settings = sheet !== null;
  useEffect(() => {
    function read() {
      setRoute(new URLSearchParams(location.hash.slice(1)));
    }
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  function sheetRoute(boardId: string, key: string | null, replace = false) {
    const params = new URLSearchParams(location.hash.slice(1));
    params.set("page", "dashboards");
    if (boardId) params.set("dashboard", boardId);
    else params.delete("dashboard");
    if (key === null) params.delete("sheet");
    else params.set("sheet", key);
    const hash = "#" + params.toString();
    if (hash !== location.hash)
      history[replace ? "replaceState" : "pushState"](null, "", hash);
    setRoute(params);
    window.scrollTo(0, 0);
  }
  const [revision, refresh] = useState(0);
  const library = useQuery<Saved[]>("dashboardLibrary", undefined, revision);
  const error = library.error;
  // The home page's dashboard is listed from its template until saved.
  const data = library.data && [
    ...(library.data.some((d) => d.definition.id === homeDashboardId)
      ? []
      : [{ definition: homeTemplate(), version: null }]),
    ...library.data,
  ];
  const [busy, working] = useState(false),
    [message, fail] = useState("");
  const [target, destination] = useState("");
  const active = data?.find((d) => d.definition.id === selected) ?? data?.[0];
  const board = active?.definition;
  useEffect(() => {
    if (!data) return;
    if (sheet === null) {
      if (draft?.board.id === route.get("dashboard"))
        history.replaceState({ worksheetDraft: draft }, "");
      else if (history.state?.worksheetDraft) history.replaceState(null, "");
      return;
    }
    const boardId = route.get("dashboard");
    const saved = data.find((d) => d.definition.id === boardId);
    const current =
      draft?.board.id === boardId
        ? draft
        : saved
          ? {
              board: structuredClone(saved.definition),
              version: saved.version,
              index: 0,
            }
          : null;
    const index = /^\d+$/.test(sheet)
      ? Number(sheet)
      : (current?.board.panels.findIndex((p) => p.id === sheet) ?? -1);
    if (!current || !Number.isInteger(index) || !current.board.panels[index]) {
      const next = new URLSearchParams(route);
      next.delete("sheet");
      history.replaceState(null, "", "#" + next);
      setRoute(next);
      return;
    }
    if (current !== draft || draft.index !== index || !draft.session) {
      for (const panel of current.board.panels)
        panel.id ??= crypto.randomUUID();
      const original =
        saved?.definition.panels.find(
          (panel) => panel.id === current.board.panels[index].id,
        ) ?? saved?.definition.panels[index];
      edit({
        ...current,
        index,
        session: {
          original:
            current === draft
              ? (original ?? null)
              : current.board.panels[index],
          direct: current !== draft && !!saved,
        },
      });
      select(current.board.id);
    } else history.replaceState({ worksheetDraft: draft }, "");
  }, [data, draft, route, sheet]);
  const initial: Panel = { ...blankPanel, minutes: seed.minutes };
  function begin(
    saved: Saved | undefined,
    index: number,
    extra?: Panel,
    configure = true,
  ) {
    const board = saved
      ? structuredClone(saved.definition)
      : {
          id: crypto.randomUUID(),
          title: "新しいダッシュボード",
          panels: [] as Panel[],
        };
    for (const panel of board.panels) panel.id ??= crypto.randomUUID();
    if (extra) {
      board.panels.push({ ...extra, id: crypto.randomUUID() });
      index = board.panels.length - 1;
    }
    sheetRoute(
      board.id,
      configure
        ? saved && !extra && !saved.definition.panels[index].id
          ? String(index)
          : (board.panels[index].id ?? String(index))
        : null,
    );
    edit({
      board,
      version: saved?.version ?? null,
      index,
      session: configure
        ? { original: extra ? null : board.panels[index], direct: !!saved }
        : undefined,
    });
    fail("");
    if (saved) select(board.id);
  }
  function append(p: Panel) {
    if (!draft) return;
    const panels = [...draft.board.panels, { ...p, id: crypto.randomUUID() }];
    sheetRoute(
      draft.board.id,
      panels[panels.length - 1].id ?? String(panels.length - 1),
      true,
    );
    edit({
      ...draft,
      board: { ...draft.board, panels },
      index: panels.length - 1,
      session: { original: null, direct: false },
    });
  }
  async function save() {
    if (!draft) return;
    working(true);
    fail("");
    try {
      await rpc(
        "applyDashboard",
        { definition: draft.board, expectedVersion: draft.version },
        true,
      );
      sheetRoute(draft.board.id, null, true);
      select(draft.board.id);
      edit(null);
      refresh((n) => n + 1);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      working(false);
    }
  }
  async function remove() {
    if (!active || !window.confirm("このダッシュボードを削除しますか？"))
      return;
    try {
      await rpc(
        "remove",
        { kind: "dashboard", id: active.definition.id },
        true,
      );
      refresh((n) => n + 1);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  if (!data)
    return (
      <p>
        <Feedback error={error} />
      </p>
    );
  if (incoming)
    return (
      <section className="card">
        <h3>この表示をダッシュボードに追加</h3>
        <p>{incoming.title}</p>
        <Select
          label="保存先"
          value={target}
          choices={[
            ["", "新しいダッシュボード"],
            ...data.map((d): [string, string] => [
              d.definition.id,
              d.definition.title,
            ]),
          ]}
          change={destination}
        />
        <div className="tools">
          <button
            type="button"
            className="primary"
            disabled={
              (data.find((d) => d.definition.id === target)?.definition.panels
                .length ?? 0) >= 24
            }
            onClick={() => {
              begin(
                data.find((d) => d.definition.id === target),
                0,
                incoming,
              );
              consumed();
            }}
          >
            編集して追加
          </button>
          <button type="button" onClick={consumed}>
            キャンセル
          </button>
        </div>
      </section>
    );
  const p = draft?.board.panels[draft.index];
  function apply(panels: Panel[], configure?: Panel) {
    if (!draft) return;
    const selected = configure ?? p;
    const index = Math.max(
      0,
      panels.findIndex((panel) => panel.id === selected?.id),
    );
    edit({
      ...draft,
      index,
      board: { ...draft.board, panels },
      session: configure
        ? {
            original:
              draft.board.panels.find((panel) => panel.id === configure.id) ??
              null,
            direct: false,
          }
        : draft.session,
    });
    if (configure) sheetRoute(draft.board.id, configure.id ?? String(index));
  }
  function finishPanel(commit: boolean) {
    if (!draft || !p || !draft.session) return;
    if (commit && draft.session.direct) {
      void save();
      return;
    }
    const { original, direct } = draft.session;
    const panels = commit
      ? draft.board.panels
      : draft.board.panels.flatMap((panel, i) =>
          i !== draft.index ? [panel] : original ? [original] : [],
        );
    edit(
      !commit && (direct || !panels.length)
        ? null
        : {
            ...draft,
            board: { ...draft.board, panels },
            index: Math.min(draft.index, panels.length - 1),
            session: undefined,
          },
    );
    sheetRoute(!panels.length ? (board?.id ?? "") : draft.board.id, null, true);
    fail("");
  }
  const worksheet = draft && settings && p && (
    <section className="worksheet" aria-label="ワークシート">
      <PanelBuilder
        minutes={seed.minutes}
        timeControl={timeControl}
        savePanel={() => finishPanel(true)}
        cancelPanel={() => finishPanel(false)}
        directSave={!!draft.session?.direct}
        actions={
          <>
            <button
              type="button"
              disabled={draft.board.panels.length >= 24}
              onClick={() => append({ ...p, title: `${p.title} のコピー` })}
            >
              パネルを複製
            </button>
            <button
              type="button"
              disabled={draft.board.panels.length === 1}
              onClick={() => {
                apply(draft.board.panels.filter((_, i) => i !== draft.index));
                sheetRoute(draft.board.id, null, true);
              }}
            >
              パネルを削除
            </button>
          </>
        }
        key={p.id}
        p={p}
        end={end}
        meta={meta}
        set={(next) =>
          apply(
            draft.board.panels.map((old, i) =>
              i === draft.index ? next : old,
            ),
          )
        }
      />
    </section>
  );
  const toolbar = draft ? (
    <>
      <ConditionBar
        data="request"
        conditions={draft.board.conditions ?? []}
        minutes={seed.minutes}
        end={end}
        change={(conditions) =>
          edit({
            ...draft,
            board: {
              ...draft.board,
              conditions: conditions.length ? conditions : undefined,
            },
          })
        }
      />
      <label className="board-name">
        名前
        <input
          required
          maxLength={512}
          value={draft.board.title}
          onChange={(e) =>
            edit({
              ...draft,
              board: { ...draft.board, title: e.target.value },
            })
          }
        />
      </label>
      <button type="submit" className="primary" disabled={busy}>
        保存
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          sheetRoute(board?.id ?? draft.board.id, null, true);
          edit(null);
          if (message) refresh((n) => n + 1);
          fail("");
        }}
      >
        キャンセル
      </button>
    </>
  ) : (
    <>
      {board && <h2>{board.title}</h2>}
      {active && (
        <>
          <Select
            label="ダッシュボード"
            value={active.definition.id}
            choices={data.map((d) => [d.definition.id, d.definition.title])}
            change={(id) => {
              select(id);
              sheetRoute(id, null, true);
            }}
          />
          <button
            className="primary"
            type="button"
            onClick={() => begin(active, 0, undefined, false)}
          >
            編集モード
          </button>
        </>
      )}
      <button type="button" onClick={() => begin(undefined, 0, initial)}>
        ダッシュボードを作成
      </button>
      {active?.version && active.definition.id !== homeDashboardId && (
        <button type="button" onClick={remove}>
          削除
        </button>
      )}
    </>
  );
  return (
    <form
      inert={busy}
      className={draft ? "editor dashboard-page" : "dashboard-page"}
      onSubmit={(e) => {
        e.preventDefault();
        if (draft && !worksheet && !busy) void save();
      }}
    >
      {message && <p role="alert">{message}</p>}
      {worksheet ? (
        worksheet
      ) : (
        <PanelLayout
          minutes={seed.minutes}
          panels={
            draft
              ? draft.board.panels
              : (board?.panels.map((panel) =>
                  withConditions(panel, board.conditions),
                ) ?? [])
          }
          end={end}
          editing={
            draft
              ? {
                  initial,
                  apply,

                  configure: (i) => {
                    edit({
                      ...draft,
                      index: i,
                      session: {
                        original: draft.board.panels[i],
                        direct: false,
                      },
                    });
                    sheetRoute(
                      draft.board.id,
                      draft.board.panels[i].id ?? String(i),
                    );
                  },
                }
              : undefined
          }
          open={(i) => begin(active, i)}
          toolbar={
            <>
              {timeControl}
              {toolbar}
            </>
          }
          viewActions={(panel, i) => (
            <div className="tools">
              <button
                type="button"
                disabled={(board?.panels.length ?? 0) >= 24}
                onClick={() =>
                  begin(active, i, {
                    ...panel,
                    title: `${panel.title} のコピー`,
                  })
                }
              >
                複製
              </button>
              {panel.data !== "daily" && (
                <a
                  href={investigatePanel(
                    { ...panel, minutes: seed.minutes },
                    end,
                  )}
                >
                  調査
                </a>
              )}
              {panel.display !== "pivot" &&
                panel.data !== "daily" &&
                panel.values.length === 1 && (
                  <button
                    type="button"
                    onClick={() => monitor({ ...panel, minutes: seed.minutes })}
                  >
                    モニター化
                  </button>
                )}
            </div>
          )}
        />
      )}
    </form>
  );
}
