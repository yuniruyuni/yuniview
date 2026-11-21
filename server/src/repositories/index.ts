import { dashboards, monitorHistory, monitors } from "./console/library";
export function createRawRepos() {
  return { dashboards, monitors, monitorHistory };
}
export type Repos = ReturnType<typeof createRawRepos>;
