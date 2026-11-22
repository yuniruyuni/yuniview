import { useEffect, useRef, useState } from "react";
import type { Dashboard, Overview, Panel } from "../../../shared/console";
import { Feedback, rpc, useQuery } from "../api";
import { PanelBuilder } from "./PanelBuilder";
import { investigatePanel, PanelView, Select } from "./Panels";

type Saved = { definition: Dashboard; version: string };
type Draft = { board: Dashboard; version: string | null; index: number };
export function DashboardWorkspace({
  end,
  meta,
  seed,
  incoming,
  consumed,
  monitor,
}: {
  end: string;
  meta: Overview;
  seed: Panel;
  incoming: Panel | null;
  consumed: () => void;
  monitor: (p: Panel) => void;
}) {
  const [selected, select] = useState("");
  const [draft, edit] = useState<Draft | null>(null);
  const editor = useRef<HTMLFormElement>(null);
  const editing = Boolean(draft);
  useEffect(() => {
    if (editing) editor.current?.scrollIntoView({ block: "start" });
  }, [editing]);
  const [revision, refresh] = useState(0);
  const { data, error } = useQuery<Saved[]>(
    "dashboardLibrary",
    undefined,
    revision,
  );
  const [busy, working] = useState(false),
    [message, fail] = useState("");
  const [target, destination] = useState("");
  const active = data?.find((d) => d.definition.id === selected) ?? data?.[0];
  const board = active?.definition;
  const initial = {
    ...seed,
    title: "メモリ使用量",
    metric: "memory.current",
    measure: "metric",
    unit: "MiB",
  } as Panel;
  function begin(saved: Saved | undefined, index: number, extra?: Panel) {
    const board = saved
      ? structuredClone(saved.definition)
      : {
          id: crypto.randomUUID(),
          title: "新しいダッシュボード",
          panels: [] as Panel[],
        };
    if (extra) {
      board.panels.push({ ...extra, id: crypto.randomUUID() });
      index = board.panels.length - 1;
    }
    edit({ board, version: saved?.version ?? null, index });
    fail("");
    if (saved) select(board.id);
  }
  function append(p: Panel) {
    if (!draft) return;
    const panels = [...draft.board.panels, { ...p, id: crypto.randomUUID() }];
    edit({
      ...draft,
      board: { ...draft.board, panels },
      index: panels.length - 1,
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
  return (
    <>
      {message && <p role="alert">{message}</p>}
      {draft && p ? (
        <form
          ref={editor}
          className="editor card studio"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="studio-head">
            <label>
              名前
              <input
                value={draft.board.title}
                maxLength={512}
                required
                onChange={(e) =>
                  edit({
                    ...draft,
                    board: { ...draft.board, title: e.target.value },
                  })
                }
              />
            </label>
            <div className="tools">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  edit(null);
                  if (message) refresh((n) => n + 1);
                  fail("");
                }}
              >
                キャンセル
              </button>
              <button className="primary" disabled={busy} type="submit">
                保存
              </button>
            </div>
          </div>
          <fieldset className="panel-strip" aria-label="パネルの選択">
            {draft.board.panels.map((item, i) => (
              <button
                type="button"
                key={item.id ?? i}
                aria-pressed={draft.index === i}
                onClick={() => edit({ ...draft, index: i })}
              >
                {item.title || "無題"}
              </button>
            ))}
            <button
              type="button"
              disabled={draft.board.panels.length >= 24}
              onClick={() => append(initial)}
            >
              ＋ パネル追加
            </button>
          </fieldset>
          <PanelBuilder
            key={p.id ?? draft.index}
            p={p}
            end={end}
            meta={meta}
            set={(next) =>
              edit({
                ...draft,
                board: {
                  ...draft.board,
                  panels: draft.board.panels.map((old, i) =>
                    i === draft.index ? next : old,
                  ),
                },
              })
            }
          />
          <div className="tools">
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
              onClick={() =>
                edit({
                  ...draft,
                  index: Math.max(0, draft.index - 1),
                  board: {
                    ...draft.board,
                    panels: draft.board.panels.filter(
                      (_, i) => i !== draft.index,
                    ),
                  },
                })
              }
            >
              パネル削除
            </button>
          </div>
        </form>
      ) : (
        <div className="tools">
          <button
            className="primary"
            type="button"
            onClick={() => begin(undefined, 0, initial)}
          >
            ダッシュボードを作成
          </button>
          {active && (
            <>
              <Select
                label="ダッシュボード"
                value={active.definition.id}
                choices={data.map((d) => [d.definition.id, d.definition.title])}
                change={select}
              />
              <button type="button" onClick={() => begin(active, 0)}>
                編集
              </button>
              <button type="button" onClick={remove}>
                削除
              </button>
            </>
          )}
        </div>
      )}
      {!draft && board && (
        <>
          <h2>{board.title}</h2>
          <div className="cards">
            {board.panels.map((panel, i) => (
              <PanelView
                key={panel.id ?? i}
                panel={panel}
                onEdit={() => begin(active, i)}
                end={end}
                actions={
                  <div className="tools">
                    <button
                      type="button"
                      disabled={board.panels.length >= 24}
                      onClick={() =>
                        begin(active, 0, {
                          ...panel,
                          title: `${panel.title} のコピー`,
                        })
                      }
                    >
                      複製
                    </button>
                    <a href={investigatePanel(panel, end)}>調査</a>
                    {panel.display !== "pivot" && (
                      <button type="button" onClick={() => monitor(panel)}>
                        モニター化
                      </button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
