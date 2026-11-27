import {
  type Dashboard,
  type FieldCondition,
  homeDashboardId,
  type Overview,
  withConditions,
} from "../../../shared/console";
import { clock, number, useQuery } from "../api";
import { investigatePanel, PanelView } from "./Panels";
import { homeTemplate } from "./templates";

type Saved = { definition: Dashboard; version: string };

/** Every service at a glance, then the home dashboard. */
export function Home({
  meta,
  conditions,
  minutes,
  end,
  openService,
  editHome,
}: {
  meta: Overview;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  openService: (source: string) => void;
  editHome: () => void;
}) {
  const library = useQuery<Saved[]>("dashboardLibrary", undefined);
  const saved = library.data?.find(
    (d) => d.definition.id === homeDashboardId,
  )?.definition;
  const board = saved ?? homeTemplate();
  const extra = [...(board.conditions ?? []), ...conditions];
  return (
    <>
      <section className="service-cards" aria-label="サービス">
        {meta.services.map((s) => (
          <button
            type="button"
            key={s.source}
            className="service-card"
            onClick={() => openService(s.source)}
          >
            <strong>{s.source}</strong>
            <small>{s.last ? `最終受信 ${clock(s.last)}` : "未受信"}</small>
            <dl>
              <div>
                <dt>リクエスト</dt>
                <dd>{number(s.requests)}</dd>
              </div>
              <div>
                <dt>失敗率</dt>
                <dd>
                  {s.requests
                    ? `${number((100 * s.errors) / s.requests)} %`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>p95</dt>
                <dd>{s.latency === null ? "—" : `${number(s.latency)} ms`}</dd>
              </div>
            </dl>
          </button>
        ))}
        {!meta.services.length && (
          <p className="empty">登録されたサービスはまだありません。</p>
        )}
      </section>
      <div className="section-head">
        <h3>{board.title}</h3>
        <button type="button" onClick={editHome}>
          ホームを編集
        </button>
      </div>
      <div className="cards">
        {board.panels.map((p) => {
          const panel = { ...withConditions(p, extra), minutes };
          return (
            <PanelView
              key={p.id ?? p.title}
              wide={p.wide}
              panel={panel}
              end={end}
              actions={<a href={investigatePanel(panel, end)}>探索</a>}
            />
          );
        })}
      </div>
    </>
  );
}
