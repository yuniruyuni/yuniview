import { createContext } from "./context";
import { closeDatabase, initDatabase } from "./infra/db";
import { createLogger } from "./infra/logger";
import { startTracing, stopTracing } from "./infra/tracing/start";
import { createApp } from "./presentation";
import { startWorker } from "./usecases/monitor";

// 何よりも先に始める。後から呼ぶと、それまでのスパンが送られない。
startTracing();

const logger = createLogger();
const db = await initDatabase(logger);
const ctx = createContext(db, logger);

const PORT = Number(process.env.PORT ?? 3000);
const app = createApp(ctx);
const stopWorker =
  process.env.SKIP_DB_VERIFY === "1" ? async () => {} : startWorker(db);

async function shutdown() {
  // 溜まっているぶんを送り切る。これが無いと落ちる直前の — いちばん見たい —
  // スパンが失われる。
  await stopWorker();
  await Promise.all([closeDatabase(), stopTracing()]);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

logger.info(`Server running on http://localhost:${PORT}`);

export default {
  hostname: "0.0.0.0",
  port: PORT,
  fetch: app.fetch,
  idleTimeout: 120,
};
