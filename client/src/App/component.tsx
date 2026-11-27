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
const icons: Record<keyof typeof pages, React.ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  explore: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  dashboards: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  monitors: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
};
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
  const changeTime = (m: number, stamp?: string) => {
    setNow(new Date().toISOString());
    navigate({ minutes: String(m), end: stamp ?? "" });
  };
  const timeControl = (
    <DashboardTime
      minutes={minutes}
      end={end}
      fixed={!!fixed}
      change={changeTime}
    />
  );
  const shared = page === "home" || page === "service" || page === "explore";
  return (
    <div className="workspace">
      <aside>
        <h1>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <rect width="20" height="20" rx="5" fill="var(--accent)" />
            <path
              d="M5 13l3-4 3 2 4-5"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          yuniview
        </h1>
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
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {icons[k as keyof typeof pages]}
              </svg>
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
          {shared && !trace && (
            <>
              <span className="divider" />
              <ConditionBar
                data={page === "explore" ? data : "request"}
                conditions={conditions}
                minutes={minutes}
                end={end}
                change={setConditions}
              />
            </>
          )}
          <div className="tools">
            <DashboardTime
              minutes={minutes}
              end={end}
              fixed={!!fixed}
              change={changeTime}
              quick
            />
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
            <button
              type="button"
              className="icon"
              aria-label="更新"
              title="更新"
              onClick={refresh}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                <path d="M20 4v7h-7" />
              </svg>
            </button>
          </div>
        </header>
        <div className="page">
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
        </div>
      </main>
    </div>
  );
}
