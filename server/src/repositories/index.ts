import { BatchRepository } from "./batch";
import { CellRepository } from "./cell";
import { CredentialRepository } from "./credential";
import { DailySetRepository } from "./daily-set";
import { DashboardRepository } from "./dashboard";
import { EventRepository } from "./event";
import { MonitorRepository } from "./monitor";
import { MonitorEventRepository } from "./monitor-event";
import { SourceRepository } from "./source";
import { UsageAgentRepository } from "./usage-agent";
import { WebhookRepository } from "./webhook";

export interface RepositoryConfig {
  webhookUrl?: string;
}

export function createRawRepos(config: RepositoryConfig = {}) {
  return {
    batches: new BatchRepository(),
    cells: new CellRepository(),
    credentials: new CredentialRepository(),
    dailySets: new DailySetRepository(),
    dashboards: new DashboardRepository(),
    events: new EventRepository("telemetry_events"),
    /** Application events and routed requests, as counted by `events` panels. */
    occurrences: new EventRepository("analysis_events"),
    monitors: new MonitorRepository(),
    monitorEvents: new MonitorEventRepository(),
    sources: new SourceRepository(),
    usageAgent: new UsageAgentRepository(),
    webhook: new WebhookRepository(config.webhookUrl),
  };
}
export type Repos = ReturnType<typeof createRawRepos>;
