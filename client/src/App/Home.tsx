import {
  blankPanel,
  type Dashboard,
  type FieldCondition,
  homeDashboardId,
  type Overview,
  type Panel,
  type Point,
  withConditions,
} from "../../../shared/console";
import { clock, number, useQuery } from "../api";
import { investigatePanel, PanelView } from "./Panels";
import { homeTemplate } from "./templates";

type Saved = { definition: Dashboard; version: string };

/** One value over time for every service, keyed by service. */
function useServiceSeries(
  values: Panel["values"],
  conditions: FieldCondition[],
  minutes: number,
  end: string,
) {
  const { data } = useQuery<Point[]>("series", {
    panel: withConditions(
      { ...blankPanel, title: "サービス", values, minutes },
      conditions,
    ),
    end,
    buckets: true,
  });
  const bySource = new Map<string, Point[]>();
  for (const p of data ?? [])
    bySource.set(p.series, [...(bySource.get(p.series) ?? []), p]);
  return bySource;
}

/** A small line of a service's recent values. */
function Spark({ points, danger }: { points?: Point[]; danger?: boolean }) {
  if (!points || points.length < 2) return <span className="spark" />;
  const sorted = [...points].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const max = Math.max(...sorted.map((p) => p.value), 1e-9);
  const d = sorted
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${((i * 120) / (sorted.length - 1)).toFixed(1)},${(
          26 - (24 * p.value) / max
        ).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      className={danger ? "spark danger" : "spark"}
      viewBox="0 0 120 28"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

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
  const requests = useServiceSeries(
    [{ agg: "count", of: [] }],
    conditions,
    minutes,
    end,
  );
  const failures = useServiceSeries(
    [{ agg: "ratio", of: ["failed"] }],
    conditions,
    minutes,
    end,
  );
  const latency = useServiceSeries(
    [{ agg: "p95", of: ["value"] }],
    conditions,
    minutes,
    end,
  );
  return (
    <>
      <section className="service-table" aria-label="サービス">
        <div className="service-row service-head" aria-hidden="true">
          <span>サービス</span>
          <span>リクエスト</span>
          <span>失敗率</span>
          <span>応答時間 p95</span>
          <span>最終受信</span>
        </div>
        {meta.services.map((s) => {
          const rate = s.requests ? (100 * s.errors) / s.requests : null;
          return (
            <button
              type="button"
              key={s.source}
              className="service-row"
              data-idle={!s.requests || undefined}
              onClick={() => openService(s.source)}
            >
              <strong>
                <i aria-hidden="true" />
                {s.source}
              </strong>
              <span>
                <b>{number(s.requests)}</b>
                <Spark points={requests.get(s.source)} />
              </span>
              <span>
                <b data-danger={!!rate || undefined}>
                  {rate === null ? "—" : number(rate)}
                  {rate !== null && <small> %</small>}
                </b>
                <Spark points={failures.get(s.source)} danger />
              </span>
              <span>
                <b>
                  {s.latency === null ? "—" : number(s.latency)}
                  {s.latency !== null && <small> ms</small>}
                </b>
                <Spark points={latency.get(s.source)} />
              </span>
              <span className="service-last">
                {s.last ? clock(s.last) : "未受信"}
              </span>
            </button>
          );
        })}
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
