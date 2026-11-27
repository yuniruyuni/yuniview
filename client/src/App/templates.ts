import {
  blankPanel,
  type Dashboard,
  homeDashboardId,
  type Panel,
} from "../../../shared/console";

/** A request panel divided by service. */
function requests(title: string, values: Panel["values"]): Panel {
  return { ...blankPanel, id: crypto.randomUUID(), title, values };
}

/** What the home page shows until someone saves their own. */
export function homeTemplate(): Dashboard {
  return {
    id: homeDashboardId,
    title: "ホーム",
    panels: [
      requests("リクエスト数", [{ agg: "count", of: [] }]),
      requests("失敗率", [{ agg: "ratio", of: ["failed"] }]),
      requests("応答時間 p95", [{ agg: "p95", of: ["value"] }]),
      {
        ...blankPanel,
        id: crypto.randomUUID(),
        title: "ログ件数",
        data: "log",
        values: [{ agg: "count", of: [] }],
      },
    ],
  };
}

/** The panels a service's page shows, narrowed to that service. */
export function servicePanels(): Panel[] {
  return [
    { ...requests("リクエスト数", [{ agg: "count", of: [] }]), group: "all" },
    { ...requests("失敗率", [{ agg: "ratio", of: ["failed"] }]), group: "all" },
    {
      ...requests("応答時間 p95", [{ agg: "p95", of: ["value"] }]),
      group: "revision",
    },
    {
      ...blankPanel,
      title: "リビジョンごとの比較",
      wide: true,
      display: "pivot",
      values: [
        { agg: "count", of: [] },
        { agg: "ratio", of: ["failed"] },
        { agg: "p95", of: ["value"] },
      ],
      pivot: { row: "revision", column: "measure", mark: "table" },
    },
  ];
}
