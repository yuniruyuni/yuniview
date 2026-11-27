import {
  type FieldCondition,
  type Overview,
  withConditions,
} from "../../../shared/console";
import { clock, number } from "../api";
import { Routes } from "./Explore";
import { investigatePanel, PanelView } from "./Panels";
import { servicePanels } from "./templates";

/** One service: its traffic, failures, latency by revision and routes. */
export function Service({
  source,
  meta,
  conditions,
  minutes,
  end,
  showTrace,
  explore,
}: {
  source: string;
  meta: Overview;
  conditions: FieldCondition[];
  minutes: number;
  end: string;
  showTrace: (id: string) => void;
  explore: (conditions: FieldCondition[]) => void;
}) {
  const stats = meta.services.find((s) => s.source === source);
  const scope: FieldCondition[] = [
    ...conditions.filter((c) => c.field !== "source"),
    { field: "source", values: [source] },
  ];
  return (
    <>
      <div className="section-head">
        <h3>{source}</h3>
        <small>
          {stats?.last ? `最終受信 ${clock(stats.last)}` : "未受信"} ·
          リクエスト {number(stats?.requests ?? 0)} · 失敗{" "}
          {number(stats?.errors ?? 0)}
        </small>
        <button type="button" onClick={() => explore(scope)}>
          このサービスを探索
        </button>
      </div>
      <div className="cards">
        {servicePanels().map((p) => {
          const panel = { ...withConditions(p, scope), minutes };
          return (
            <PanelView
              key={p.title}
              wide={p.wide}
              panel={panel}
              end={end}
              actions={<a href={investigatePanel(panel, end)}>探索</a>}
            />
          );
        })}
      </div>
      <h3>ルート</h3>
      <Routes
        conditions={scope}
        minutes={minutes}
        end={end}
        showTrace={showTrace}
        narrow={(route) =>
          explore([...scope, { field: "text", contains: route }])
        }
      />
    </>
  );
}
