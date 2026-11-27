import { useEffect, useState } from "react";
import {
  blankPanel,
  type FieldCondition,
  homeDashboardId,
  type Monitor,
  type Overview,
  type Panel,
} from "../../../shared/console";
import { useQuery } from "../api";
import { ConditionBar } from "./ConditionBar";
import { DashboardTime } from "./DashboardTime";
import { DashboardWorkspace } from "./DashboardWorkspace";
import { DictionaryProvider } from "./dictionary";
import { Explore, type RowData, rowData, Trace } from "./Explore";
import { Home } from "./Home";
import { Monitors, makeMonitor } from "./Monitors";
import { Service } from "./Service";
import { Settings } from "./Settings";

const pages = {
  home: "ホーム",
  explore: "探索",
  dashboards: "ダッシュボード",
  monitors: "モニター",
  settings: "設定",
};
type Page = keyof typeof pages | "service";
const empty: Overview = { services: [], metrics: [], dailyFields: [] };

function read() {
  return new URLSearchParams(location.hash.slice(1));
}
/** A link to the console with some parameters changed. */
function link(params: Record<string, string>) {
  const p = read();
  if (params.page && params.page !== p.get("page")) {
    for (const k of ["sheet", "dashboard", "trace", "service", "columns"])
      p.delete(k);
  }
  for (const [k, v] of Object.entries(params)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  return `#${p.toString()}`;
}
function navigate(params: Record<string, string>) {
  window.location.hash = link(params);
}
function parseConditions(raw: string | null): FieldCondition[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function App() {
  return (
    <DictionaryProvider>
      <Console />
    </DictionaryProvider>
  );
}

function Console() {
  const [incoming, setIncoming] = useState<Panel | null>(null);
  const [incomingMonitor, setIncomingMonitor] = useState<Monitor | null>(null);
  const [url, setUrl] = useState(read);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    const change = () => setUrl(read());
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(timer);
  }, [auto]);
  const key = url.get("page") ?? "";
  const page: Page =
    key === "service" || Object.hasOwn(pages, key) ? (key as Page) : "home";
  const minutes = Math.min(
    43200,
    Math.max(1, Math.round(Number(url.get("minutes") || 60) || 60)),
  );
  const fixed = url.get("end");
  const end =
    fixed && Number.isFinite(Date.parse(fixed))
      ? new Date(fixed).toISOString()
      : now;
  const conditions = parseConditions(url.get("conditions"));
  const data = (rowData as string[]).includes(url.get("data") ?? "")
    ? (url.get("data") as RowData)
    : "log";
  const columns = (url.get("columns") ?? "").split(",").filter(Boolean);
  const query = useQuery<Overview>("overview", {
    minutes,
    conditions: page === "home" ? conditions : undefined,
    end,
  });
  const meta = query.data ?? empty;
  const trace = url.get("trace") ?? "";
  const showTrace = (id: string) => navigate({ trace: id });
  const setConditions = (list: FieldCondition[]) =>
    navigate({ conditions: list.length ? JSON.stringify(list) : "" });
  const refresh = () => {
    setNow(new Date().toISOString());
    navigate({ end: "" });
  };
  const timeControl = (
    <DashboardTime
      minutes={minutes}
      end={end}
      fixed={!!fixed}
      change={(m, stamp) => {
        setNow(new Date().toISOString());
        navigate({ minutes: String(m), end: stamp ?? "" });
      }}
    />
  );
  const shared = page === "home" || page === "service" || page === "explore";
  return (
    <div className="workspace">
      <aside>
        <h1>yuniview</h1>
        <nav aria-label="メインナビゲーション">
          {Object.entries(pages).map(([k, title]) => (
            <button
              type="button"
              key={k}
              aria-current={
                page === k || (page === "service" && k === "home")
                  ? "page"
                  : undefined
              }
              onClick={() => navigate({ page: k, trace: "" })}
            >
              {title}
            </button>
          ))}
          <a className="privacy-link" href="/privacy/">
            プライバシーポリシー
          </a>
        </nav>
      </aside>
      <main>
        <header>
          <h2>
            {trace
              ? "トレース"
              : page === "service"
                ? (url.get("service") ?? "サービス")
                : pages[page]}
          </h2>
          <div className="tools">
            {timeControl}
            <label className="inline">
              <input
                type="checkbox"
                checked={auto && !fixed}
                onChange={(e) => {
                  setAuto(e.target.checked);
                  if (fixed) refresh();
                }}
              />
              自動更新
            </label>
            <button type="button" onClick={refresh}>
              更新
            </button>
          </div>
        </header>
        {shared && !trace && (
          <ConditionBar
            data={page === "explore" ? data : "request"}
            conditions={conditions}
            minutes={minutes}
            end={end}
            change={setConditions}
          />
        )}
        {query.error && (
          <p role="alert">サービス情報の取得に失敗しました。{query.error}</p>
        )}
        {trace ? (
          <>
            <button type="button" onClick={() => navigate({ trace: "" })}>
              戻る
            </button>
            <Trace id={trace} />
          </>
        ) : page === "home" ? (
          <Home
            meta={meta}
            conditions={conditions}
            minutes={minutes}
            end={end}
            openService={(s) => navigate({ page: "service", service: s })}
            editHome={() =>
              navigate({ page: "dashboards", dashboard: homeDashboardId })
            }
          />
        ) : page === "service" ? (
          <Service
            source={url.get("service") ?? ""}
            meta={meta}
            conditions={conditions}
            minutes={minutes}
            end={end}
            showTrace={showTrace}
            explore={(list) =>
              navigate({
                page: "explore",
                data: "request",
                conditions: JSON.stringify(list),
              })
            }
          />
        ) : page === "explore" ? (
          <Explore
            data={data}
            conditions={conditions}
            minutes={minutes}
            end={end}
            meta={meta}
            columns={columns}
            setData={(d) => navigate({ data: d, columns: "" })}
            setConditions={setConditions}
            setColumns={(c) => navigate({ columns: c.join(",") })}
            setRange={(m, stamp) =>
              navigate({ minutes: String(m), end: stamp })
            }
            rangeHref={(m, stamp) => link({ minutes: String(m), end: stamp })}
            showTrace={showTrace}
            toPanel={(p) => {
              setIncoming(p);
              navigate({ page: "dashboards", conditions: "" });
            }}
          />
        ) : page === "dashboards" ? (
          <DashboardWorkspace
            timeControl={timeControl}
            end={end}
            meta={meta}
            seed={{ ...blankPanel, minutes }}
            incoming={incoming}
            consumed={() => setIncoming(null)}
            monitor={(p) => {
              setIncomingMonitor(makeMonitor(p));
              navigate({ page: "monitors" });
            }}
          />
        ) : page === "monitors" ? (
          <Monitors
            meta={meta}
            end={end}
            timeControl={timeControl}
            incoming={incomingMonitor}
            consumed={() => setIncomingMonitor(null)}
          />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  );
}
